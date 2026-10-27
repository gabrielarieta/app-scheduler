import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { RequestUser } from '../common/decorators';
import { AvailabilityStatus, ReservationStatus, TargetType } from '../common/enums';
import { Combination } from '../combinations/combination.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { Reservation } from '../reservations/reservation.schema';
import { Resource } from '../resources/resource.schema';
import { Room } from '../rooms/room.schema';
import { JoinWaitlistDto } from './waitlist.dto';
import { WaitlistEntry } from './waitlist.schema';

type Refs = { roomId?: Types.ObjectId; resourceId?: Types.ObjectId; combinationId?: Types.ObjectId };

/** Fila de quem quer um horário ocupado. Avisa (não reserva sozinho) quando o horário liberar. */
@Injectable()
export class WaitlistService {
  constructor(
    @InjectModel(WaitlistEntry.name) private readonly entries: Model<WaitlistEntry>,
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(Resource.name) private readonly resources: Model<Resource>,
    @InjectModel(Combination.name) private readonly combos: Model<Combination>,
    private readonly notifications: NotificationsService,
  ) {}

  async join(dto: JoinWaitlistDto, user: RequestUser) {
    const start = new Date(dto.start);
    const end = new Date(dto.end);
    if (isNaN(+start) || isNaN(+end) || end <= start) throw new BadRequestException('Datas inválidas.');
    if (+start < Date.now()) throw new BadRequestException('Este horário já passou.');

    const { refs, label } = await this.resolve(dto);
    if (!(await this.reservations.exists(this.conflict(refs, start, end)))) {
      throw new ConflictException('Este horário está livre: faça a reserva diretamente.');
    }
    const existing = await this.entries.findOne({
      userId: new Types.ObjectId(user.id), targetType: dto.targetType, ...refs, start, end, status: 'WAITING',
    });
    if (existing) return existing;
    return this.entries.create({
      userId: new Types.ObjectId(user.id), targetType: dto.targetType, ...refs, label, start, end, expireAt: end,
    });
  }

  list(user: RequestUser) {
    return this.entries.find({ userId: new Types.ObjectId(user.id) }).sort({ start: 1 }).limit(200);
  }

  async remove(id: string, user: RequestUser) {
    const r = await this.entries.deleteOne({ _id: id, userId: new Types.ObjectId(user.id) });
    if (!r.deletedCount) throw new NotFoundException('Item não encontrado');
  }

  /** Um intervalo de sala/recurso ficou livre (reserva cancelada/remarcada). */
  onFreed(refs: { roomId?: Types.ObjectId; resourceId?: Types.ObjectId }, start: Date, end: Date) {
    return this.check({ start: { $lt: end }, end: { $gt: start }, $or: this.refsOr(refs) });
  }

  /** Sala/recurso voltou de manutenção. */
  recheckTarget(refs: { roomId?: Types.ObjectId; resourceId?: Types.ObjectId; combinationId?: Types.ObjectId }) {
    const or = [...this.refsOr(refs), ...(refs.combinationId ? [{ combinationId: refs.combinationId }] : [])];
    return this.check({ $or: or });
  }

  // ------------------------------------------------------------ internos

  private refsOr(refs: { roomId?: Types.ObjectId; resourceId?: Types.ObjectId }) {
    const or: FilterQuery<WaitlistEntry>[] = [];
    if (refs.roomId) or.push({ roomId: refs.roomId });
    if (refs.resourceId) or.push({ resourceId: refs.resourceId });
    return or;
  }

  private async check(extra: FilterQuery<WaitlistEntry>) {
    if (!(extra.$or as unknown[])?.length) return;
    try {
      const waiting = await this.entries.find({ status: 'WAITING', start: { $gt: new Date() }, ...extra }).limit(200);
      for (const e of waiting) {
        const refs: Refs = { roomId: e.roomId, resourceId: e.resourceId };
        if (await this.reservations.exists(this.conflict(refs, e.start, e.end))) continue;
        if (!(await this.available(e))) continue;
        const r = await this.entries.updateOne({ _id: e._id, status: 'WAITING' }, { $set: { status: 'NOTIFIED', notifiedAt: new Date() } });
        if (r.modifiedCount) {
          await this.notifications.notify([e.userId], {
            type: 'WAITLIST_SLOT_FREE',
            title: 'Um horário que você queria ficou livre',
            body: `${e.label ?? 'Item'} — ${e.start.toLocaleString('pt-BR')}. Reserve antes que outra pessoa o faça.`,
            data: { waitlistId: e.id, targetType: e.targetType, roomId: e.roomId?.toString(), resourceId: e.resourceId?.toString(), combinationId: e.combinationId?.toString(), start: e.start, end: e.end },
          });
        }
      }
    } catch {
      /* a fila nunca derruba a operação que a acionou */
    }
  }

  private async available(e: WaitlistEntry): Promise<boolean> {
    const ok = (d: { status: AvailabilityStatus } | null) => !!d && d.status === AvailabilityStatus.AVAILABLE;
    if (e.roomId && !ok(await this.rooms.findById(e.roomId))) return false;
    if (e.resourceId && !ok(await this.resources.findById(e.resourceId))) return false;
    if (e.combinationId && !ok(await this.combos.findById(e.combinationId))) return false;
    return true;
  }

  private conflict(refs: Refs, start: Date, end: Date): FilterQuery<Reservation> {
    const or: FilterQuery<Reservation>[] = [];
    if (refs.roomId) or.push({ roomId: refs.roomId });
    if (refs.resourceId) or.push({ resourceId: refs.resourceId });
    return { status: ReservationStatus.ACTIVE, start: { $lt: end }, end: { $gt: start }, $or: or };
  }

  private async resolve(dto: JoinWaitlistDto): Promise<{ refs: Refs; label: string }> {
    if (dto.targetType === TargetType.ROOM) {
      const r = await this.rooms.findById(dto.roomId);
      if (!r) throw new NotFoundException('Sala não encontrada');
      return { refs: { roomId: r._id }, label: r.name };
    }
    if (dto.targetType === TargetType.RESOURCE) {
      const r = await this.resources.findById(dto.resourceId);
      if (!r) throw new NotFoundException('Recurso não encontrado');
      return { refs: { resourceId: r._id }, label: r.name };
    }
    const c = await this.combos.findById(dto.combinationId);
    if (!c) throw new NotFoundException('Combinação não encontrada');
    const [room, res] = await Promise.all([this.rooms.findById(c.room), this.resources.findById(c.resource)]);
    if (!room || !res) throw new NotFoundException('Sala ou recurso da combinação não existe mais');
    return { refs: { roomId: room._id, resourceId: res._id, combinationId: c._id }, label: `${room.name} + ${res.name}` };
  }
}
