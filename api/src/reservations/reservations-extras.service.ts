import {
  ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, timingSafeEqual } from 'crypto';
import { Model, Types } from 'mongoose';
import { RequestUser } from '../common/decorators';
import { ApprovalStatus, AvailabilityStatus, CancelReason, ReservationStatus, Role } from '../common/enums';
import { canAdminUnit } from '../common/scope';
import { NotificationsService } from '../notifications/notifications.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { Reservation, ReservationDocument } from './reservation.schema';
import { CreateSeriesDto } from './reservations.dto';
import { ReservationsService } from './reservations.service';

const WINDOW_MS = 5 * 60_000; // o código de check-in muda a cada 5 min
const EARLY_MS = 15 * 60_000; // check-in abre 15 min antes do início
const WEEK_MS = 7 * 86_400_000;

@Injectable()
export class ReservationsExtrasService {
  private readonly secret: string;

  constructor(
    @InjectModel(Reservation.name) private readonly model: Model<Reservation>,
    private readonly reservations: ReservationsService,
    private readonly notifications: NotificationsService,
    private readonly waitlist: WaitlistService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<string>('JWT_SECRET');
  }

  // ------------------------------------------------------------ recorrência

  /**
   * Cria N reservas semanais (a cada `everyWeeks` semanas). SKIP: pula as que conflitam e informa;
   * FAIL: se alguma falhar, desfaz as já criadas. (Soma 7 dias em UTC: em fusos com horário de verão
   * a hora local pode deslocar — o servidor então recusa/avisa a ocorrência.)
   */
  async createSeries(dto: CreateSeriesDto, user: RequestUser) {
    const seriesId = new Types.ObjectId();
    const step = (dto.everyWeeks ?? 1) * WEEK_MS;
    const mode = dto.onConflict ?? 'SKIP';
    const created: any[] = [];
    const skipped: { start: string; reason: string }[] = [];
    let firstError: HttpException | undefined;

    for (let i = 0; i < dto.occurrences; i++) {
      const start = new Date(+new Date(dto.start) + i * step).toISOString();
      const end = new Date(+new Date(dto.end) + i * step).toISOString();
      try {
        created.push(await this.reservations.create({ ...dto, start, end }, user, { seriesId, silent: true }));
      } catch (err) {
        if (!(err instanceof HttpException) || ![400, 409].includes(err.getStatus())) throw err;
        firstError ??= err;
        if (mode === 'FAIL') {
          for (const c of created) await this.reservations.cancel(c.id, user, { silent: true }).catch(() => undefined);
          throw err;
        }
        skipped.push({ start, reason: err.message });
      }
    }
    if (!created.length) throw firstError ?? new ConflictException('Nenhuma ocorrência pôde ser criada.');

    if (created[0].approvalStatus === ApprovalStatus.PENDING) {
      await this.reservations.notifyApprovers(created[0]);
    } else if (created[0].viewers.length) {
      await this.notifications.notify(created[0].viewers.map((v: any) => v.userId), {
        type: 'RESERVATION_ADDED',
        title: 'Você foi adicionado a uma série de reservas',
        body: `${dto.title}: ${created.length} ocorrências, a partir de ${new Date(created[0].start).toLocaleDateString('pt-BR')}.`,
        data: { seriesId: seriesId.toHexString(), reservationId: created[0].id },
      });
    }
    return { seriesId: seriesId.toHexString(), created, skipped };
  }

  async cancelSeries(seriesId: string, user: RequestUser) {
    const list = await this.model.find({
      seriesId: new Types.ObjectId(seriesId), status: ReservationStatus.ACTIVE, end: { $gt: new Date() },
    });
    if (!list.length) throw new NotFoundException('Nenhuma reserva futura nesta série.');
    if (!list.every((r) => canAdminUnit(user, r.unitId) || r.createdBy.toString() === user.id)) {
      throw new ForbiddenException('Apenas quem criou a série (ou o admin) pode cancelá-la.');
    }
    const viewerIds = new Set<string>();
    for (const r of list) {
      await this.reservations.cancel(r.id, user, { silent: true });
      r.viewers.forEach((v) => viewerIds.add(v.userId.toString()));
      await this.waitlist.onFreed({ roomId: r.roomId, resourceId: r.resourceId }, r.start, r.end);
    }
    viewerIds.delete(user.id);
    await this.notifications.notify([...viewerIds], {
      type: 'SERIES_CANCELLED',
      title: 'Série de reservas cancelada',
      body: `"${list[0].title}": ${list.length} reservas futuras canceladas por ${user.name}.`,
      data: { seriesId },
    });
    return { cancelled: list.length };
  }

  // ------------------------------------------------------------ check-in (QR / código)

  private codeFor(reservationId: string, window: number): string {
    const h = createHmac('sha256', this.secret).update(`${reservationId}:${window}`).digest();
    return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
  }

  /** Organizador/admin exibe este código (ou o QR com ele) no local. */
  async checkInCode(id: string, user: RequestUser) {
    const doc = await this.model.findById(id);
    if (!doc) throw new NotFoundException('Reserva não encontrada');
    if (!canAdminUnit(user, doc.unitId) && doc.createdBy.toString() !== user.id) {
      throw new ForbiddenException('Apenas quem fez a marcação (ou o gestor) vê o código.');
    }
    if (doc.status !== ReservationStatus.ACTIVE) throw new ConflictException('Reserva cancelada.');
    const w = Math.floor(Date.now() / WINDOW_MS);
    const code = this.codeFor(id, w);
    return { code, expiresAt: new Date((w + 1) * WINDOW_MS), qr: `agenda://checkin/${id}/${code}` };
  }

  /** O consultor registra presença real informando o código exibido no local. Idempotente. */
  async checkIn(id: string, code: string, user: RequestUser) {
    const uid = new Types.ObjectId(user.id);
    const doc = await this.model.findOne({ _id: id, 'viewers.userId': uid });
    if (!doc) throw new NotFoundException('Reserva não encontrada');
    if (doc.status !== ReservationStatus.ACTIVE) throw new ConflictException('Reserva cancelada.');
    if (doc.approvalStatus === ApprovalStatus.PENDING) throw new ConflictException('Reserva aguardando aprovação.');
    const now = Date.now();
    if (now < +doc.start - EARLY_MS || now > +doc.end) {
      throw new ConflictException('Check-in disponível de 15 min antes do início até o fim da reserva.');
    }
    if (doc.viewers.find((v) => v.userId.equals(uid))?.checkedInAt) return doc;

    const w = Math.floor(now / WINDOW_MS);
    const given = Buffer.from(code);
    const valid = [w, w - 1].some((win) => {
      const expected = Buffer.from(this.codeFor(id, win));
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
    if (!valid) throw new ConflictException('Código inválido ou expirado.');

    const updated = await this.model.findOneAndUpdate(
      { _id: doc._id, status: ReservationStatus.ACTIVE, 'viewers.userId': uid },
      { $set: { 'viewers.$.checkedInAt': new Date() } },
      { new: true },
    );
    return updated ?? doc;
  }

  // ------------------------------------------------------------ manutenção / indisponibilidade

  /**
   * Chamado pelo catálogo ao mudar o status de sala/recurso/combinação.
   * Avisa donos e consultores das reservas futuras afetadas e, se pedido, cancela todas.
   */
  async onTargetStatusChange(
    field: 'roomId' | 'resourceId' | 'combinationId',
    id: string,
    label: string,
    status: AvailabilityStatus,
    note: string | undefined,
    cancel: boolean,
    actor: RequestUser,
  ): Promise<{ affectedReservations: number; cancelledReservations: number }> {
    const oid = new Types.ObjectId(id);
    if (status === AvailabilityStatus.AVAILABLE) {
      await this.waitlist.recheckTarget({ [field]: oid });
      return { affectedReservations: 0, cancelledReservations: 0 };
    }

    const affected = await this.model.find({
      [field]: oid, status: ReservationStatus.ACTIVE, end: { $gt: new Date() },
    });
    const why = note ? ` Motivo: ${note}.` : '';
    let cancelled = 0;
    for (const r of affected) {
      if (cancel) {
        await this.reservations.cancel(r.id, { ...actor, role: Role.ADMIN }, { silent: true, reason: CancelReason.MAINTENANCE });
        cancelled++;
      }
      const people = new Set([r.createdBy.toString(), ...r.viewers.map((v) => v.userId.toString())]);
      people.delete(actor.id);
      await this.notifications.notify([...people], {
        type: cancel ? 'RESERVATION_CANCELLED' : 'RESERVATION_AFFECTED',
        title: cancel ? 'Reserva cancelada por indisponibilidade' : 'Reserva afetada por manutenção',
        body: `${label} ficou indisponível e a reserva "${r.title}" de ${r.start.toLocaleString('pt-BR')} ${cancel ? 'foi cancelada' : 'pode ser afetada'}.${why}`,
        data: { reservationId: r.id },
      });
    }
    return { affectedReservations: affected.length, cancelledReservations: cancelled };
  }

  // ------------------------------------------------------------ aprovação (itens sensíveis)

  /** Pendências da(s) unidade(s) do gestor (admin vê todas). */
  pending(user: RequestUser) {
    const filter: Record<string, unknown> = {
      approvalStatus: ApprovalStatus.PENDING,
      status: ReservationStatus.ACTIVE,
      end: { $gt: new Date() },
    };
    if (user.role === Role.MANAGER) filter.unitId = { $in: user.unitIds.map((i) => new Types.ObjectId(i)) };
    return this.model.find(filter).sort({ start: 1 }).limit(200);
  }

  private async loadForDecision(id: string, user: RequestUser): Promise<ReservationDocument> {
    const doc = await this.model.findById(id);
    if (!doc) throw new NotFoundException('Reserva não encontrada');
    if (!canAdminUnit(user, doc.unitId)) throw new ForbiddenException('Apenas o gestor da unidade (ou o admin) decide.');
    if (doc.createdBy.toString() === user.id && user.role !== Role.ADMIN) {
      throw new ForbiddenException('Você não pode aprovar a própria reserva.');
    }
    if (doc.status !== ReservationStatus.ACTIVE || doc.approvalStatus !== ApprovalStatus.PENDING) {
      throw new ConflictException('Esta reserva não está aguardando aprovação.');
    }
    return doc;
  }

  private decision(status: ApprovalStatus, user: RequestUser, note?: string) {
    return {
      approvalStatus: status,
      decidedBy: new Types.ObjectId(user.id),
      decidedByName: user.name,
      decidedAt: new Date(),
      decisionNote: note,
    };
  }

  async approve(id: string, user: RequestUser, note?: string) {
    const doc = await this.loadForDecision(id, user);
    const updated = await this.model.findOneAndUpdate(
      { _id: doc._id, approvalStatus: ApprovalStatus.PENDING, status: ReservationStatus.ACTIVE },
      { $set: this.decision(ApprovalStatus.APPROVED, user, note) },
      { new: true },
    );
    if (!updated) throw new ConflictException('A reserva mudou enquanto você decidia.');
    await this.notifications.notify([doc.createdBy], {
      type: 'RESERVATION_APPROVED',
      title: 'Reserva aprovada',
      body: `"${doc.title}" foi aprovada por ${user.name}.${note ? ` ${note}` : ''}`,
      data: { reservationId: doc.id },
    });
    await this.notifications.notify(doc.viewers.map((v) => v.userId), {
      type: 'RESERVATION_ADDED',
      title: 'Você foi adicionado a uma reserva',
      body: `${doc.title} — ${doc.start.toLocaleString('pt-BR')}`,
      data: { reservationId: doc.id },
    });
    return updated;
  }

  async reject(id: string, user: RequestUser, note?: string) {
    const doc = await this.loadForDecision(id, user);
    await this.reservations.cancel(id, { ...user, role: Role.ADMIN }, { silent: true, reason: CancelReason.REJECTED });
    const updated = await this.model.findByIdAndUpdate(
      id,
      { $set: this.decision(ApprovalStatus.REJECTED, user, note) },
      { new: true },
    );
    await this.notifications.notify([doc.createdBy], {
      type: 'RESERVATION_REJECTED',
      title: 'Reserva não aprovada',
      body: `"${doc.title}" foi recusada por ${user.name}.${note ? ` Motivo: ${note}` : ''}`,
      data: { reservationId: doc.id },
    });
    await this.waitlist.onFreed({ roomId: doc.roomId, resourceId: doc.resourceId }, doc.start, doc.end);
    return updated;
  }

  /** O organizador "inicia" a reserva (conta como presença dele para o no-show). */
  async start(id: string, user: RequestUser) {
    const doc = await this.model.findById(id);
    if (!doc) throw new NotFoundException('Reserva não encontrada');
    if (!canAdminUnit(user, doc.unitId) && doc.createdBy.toString() !== user.id) {
      throw new ForbiddenException('Apenas quem fez a marcação (ou o gestor) inicia a reserva.');
    }
    if (doc.status !== ReservationStatus.ACTIVE) throw new ConflictException('Reserva cancelada.');
    if ([ApprovalStatus.PENDING, ApprovalStatus.REJECTED, ApprovalStatus.EXPIRED].includes(doc.approvalStatus)) {
      throw new ConflictException('Reserva sem aprovação.');
    }
    const now = Date.now();
    if (now < +doc.start - EARLY_MS || now > +doc.end) {
      throw new ConflictException('Só dá para iniciar de 15 min antes do início até o fim da reserva.');
    }
    if (doc.startedAt) return doc;
    const updated = await this.model.findOneAndUpdate(
      { _id: doc._id, status: ReservationStatus.ACTIVE },
      { $set: { startedAt: new Date() } },
      { new: true },
    );
    return updated ?? doc;
  }
}
