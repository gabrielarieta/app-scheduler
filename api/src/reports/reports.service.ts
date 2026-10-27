import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { localParts, toMinutes } from '../common/availability.util';
import { RequestUser } from '../common/decorators';
import { ApprovalStatus, CancelReason, ReservationStatus, Role } from '../common/enums';
import { canAdminUnit } from '../common/scope';
import { Reservation } from '../reservations/reservation.schema';
import { Resource } from '../resources/resource.schema';
import { Room } from '../rooms/room.schema';
import { Unit } from '../units/unit.schema';
import { ReportQueryDto } from './reports.dto';

const DAY = 86_400_000;
const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10_000) / 10_000 : null);

interface Acc {
  id: string;
  name: string;
  unitId?: string;
  reservations: number;
  reservedMinutes: number;
  availableMinutes: number;
  noShow: number;
  attended: number;
}

@Injectable()
export class ReportsService {
  private readonly tz: string;

  constructor(
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(Resource.name) private readonly resources: Model<Resource>,
    @InjectModel(Unit.name) private readonly units: Model<Unit>,
    config: ConfigService,
  ) {
    this.tz = config.get<string>('APP_TIMEZONE') ?? 'America/Sao_Paulo';
  }

  /**
   * Taxa de uso por sala/recurso (minutos reservados ÷ minutos disponíveis), no-show,
   * presença e horários de pico. Considera reservas que COMEÇAM no período.
   * Gestor só enxerga as suas unidades. Use `from`/`to` em meia-noite local para contas exatas.
   */
  async occupancy(q: ReportQueryDto, user: RequestUser) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (!(to > from)) throw new BadRequestException('"to" deve ser posterior a "from".');
    if (+to - +from > 92 * DAY) throw new BadRequestException('Período máximo: 92 dias.');

    let unitIds: Types.ObjectId[] | undefined;
    if (q.unitId) {
      if (!canAdminUnit(user, q.unitId)) throw new ForbiddenException('Você não gerencia esta unidade.');
      unitIds = [new Types.ObjectId(q.unitId)];
    } else if (user.role === Role.MANAGER) {
      unitIds = user.unitIds.map((i) => new Types.ObjectId(i));
    }
    const scope = unitIds ? { unitId: { $in: unitIds } } : {};

    const [rooms, resources, units, list] = await Promise.all([
      this.rooms.find(scope).lean(),
      this.resources.find(scope).lean(),
      this.units.find().lean(),
      this.reservations
        .find({
          ...scope,
          start: { $gte: from, $lt: to },
          approvalStatus: { $nin: [ApprovalStatus.PENDING, ApprovalStatus.REJECTED, ApprovalStatus.EXPIRED] },
          $or: [{ status: ReservationStatus.ACTIVE }, { cancelReason: CancelReason.NO_SHOW }],
        })
        .select('roomId resourceId unitId start end status cancelReason startedAt viewers.checkedInAt')
        .limit(20_000)
        .lean(),
    ]);

    const unitTz = new Map(units.map((u) => [String(u._id), u.timezone || this.tz]));
    const tzOf = (unitId?: unknown) => (unitId ? unitTz.get(String(unitId)) : undefined) ?? this.tz;

    const wdCache = new Map<string, number[]>();
    const weekdayCounts = (tz: string) => {
      let c = wdCache.get(tz);
      if (!c) {
        c = Array(7).fill(0) as number[];
        for (let t = +from; t < +to; t += DAY) c[localParts(new Date(t), tz).weekday]++;
        wdCache.set(tz, c);
      }
      return c;
    };
    const available = (slots: { weekday: number; start: string; end: string }[], tz: string) => {
      const c = weekdayCounts(tz);
      return slots.reduce((sum, s) => sum + c[s.weekday] * (toMinutes(s.end) - toMinutes(s.start)), 0);
    };
    const mk = (d: any): Acc => ({
      id: String(d._id),
      name: d.name,
      unitId: d.unitId ? String(d.unitId) : undefined,
      reservations: 0,
      reservedMinutes: 0,
      noShow: 0,
      attended: 0,
      availableMinutes: available(d.availability ?? [], tzOf(d.unitId)),
    });
    const roomAcc = new Map(rooms.map((r) => [String(r._id), mk(r)]));
    const resAcc = new Map(resources.map((r) => [String(r._id), mk(r)]));

    const byHour: number[] = Array(24).fill(0);
    const byWeekday: number[] = Array(7).fill(0);
    const heat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    const tot = { reservations: 0, reservedMinutes: 0, noShow: 0, attended: 0 };

    for (const r of list as any[]) {
      const active = r.status === ReservationStatus.ACTIVE;
      const noShow = !active && r.cancelReason === CancelReason.NO_SHOW;
      const mins = (+r.end - +r.start) / 60_000;
      const attended = active && (!!r.startedAt || (r.viewers ?? []).some((v: any) => v.checkedInAt));

      const accs = [roomAcc.get(String(r.roomId)), resAcc.get(String(r.resourceId))].filter(Boolean) as Acc[];
      for (const a of accs) {
        a.reservations++;
        if (active) a.reservedMinutes += mins;
        if (noShow) a.noShow++;
        if (attended) a.attended++;
      }
      tot.reservations++;
      if (active) tot.reservedMinutes += mins;
      if (noShow) tot.noShow++;
      if (attended) tot.attended++;

      if (active) {
        // reservas são de um único dia: distribui os minutos pelas horas locais
        const p = localParts(r.start, tzOf(r.unitId));
        let m = p.minutes;
        let left = mins;
        while (left > 0 && m < 1440) {
          const h = Math.floor(m / 60);
          const chunk = Math.min(left, (h + 1) * 60 - m);
          byHour[h] += chunk;
          byWeekday[p.weekday] += chunk;
          heat[p.weekday][h] += chunk;
          m += chunk;
          left -= chunk;
        }
      }
    }

    const fin = (a: Acc) => ({
      ...a,
      occupancyRate: rate(a.reservedMinutes, a.availableMinutes),
      noShowRate: rate(a.noShow, a.reservations),
      attendanceRate: rate(a.attended, a.reservations - a.noShow),
    });
    const sorted = (m: Map<string, Acc>) =>
      [...m.values()].map(fin).sort((x, y) => (y.occupancyRate ?? -1) - (x.occupancyRate ?? -1));

    const top = heat
      .flatMap((row, weekday) => row.map((minutes, hour) => ({ weekday, hour, minutes })))
      .filter((c) => c.minutes > 0)
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 5);

    return {
      range: { from, to },
      unitId: q.unitId ?? null,
      totals: { ...tot, noShowRate: rate(tot.noShow, tot.reservations) },
      rooms: sorted(roomAcc),
      resources: sorted(resAcc),
      peak: { byHour, byWeekday, top },
    };
  }

  toCsv(r: Awaited<ReturnType<ReportsService['occupancy']>>): string {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['tipo', 'nome', 'unidade', 'reservas', 'minutos_reservados', 'minutos_disponiveis', 'taxa_ocupacao', 'no_show', 'taxa_no_show', 'presencas'];
    const row = (tipo: string, a: (typeof r.rooms)[number]) =>
      [tipo, a.name, a.unitId, a.reservations, a.reservedMinutes, a.availableMinutes, a.occupancyRate, a.noShow, a.noShowRate, a.attended].map(esc).join(',');
    return [head.join(','), ...r.rooms.map((a) => row('sala', a)), ...r.resources.map((a) => row('recurso', a))].join('\n') + '\n';
  }
}
