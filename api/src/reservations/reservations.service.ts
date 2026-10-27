import { canAdminUnit, inUnitScope } from '../common/scope';
import { Unit } from '../units/unit.schema';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model, Types, UpdateQuery } from 'mongoose';
import { paginate } from '../common/pagination.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import {
  Slot,
  endMinutesOnStartDay,
  fitsInAvailability,
  localParts,
} from '../common/availability.util';
import { RequestUser } from '../common/decorators';
import {
  ApprovalStatus,
  AvailabilityStatus,
  CancelReason,
  ReservationStatus,
  Role,
  STATUS_LABEL,
  TargetType,
} from '../common/enums';
import { targetLockKeys, userLockKeys } from '../common/slots.util';
import { Combination } from '../combinations/combination.schema';
import { Resource } from '../resources/resource.schema';
import { Room } from '../rooms/room.schema';
import { UsersService } from '../users/users.service';
import { LockConflictError, ReservationLocksService } from './reservation-locks.service';
import {
  AddViewersDto,
  BusyQueryDto,
  CreateReservationDto,
  QueryReservationsDto,
  UpdateReservationDto,
} from './reservations.dto';
import {
  Reservation,
  ReservationDocument,
  ReservationSnapshot,
  SnapshotEntity,
} from './reservation.schema';

interface Entity {
  label: string;
  status: AvailabilityStatus;
  statusNote?: string;
  availability: Slot[];
}
interface Refs {
  roomId?: Types.ObjectId;
  resourceId?: Types.ObjectId;
  combinationId?: Types.ObjectId;
}
interface LoadedTarget {
  refs: Refs;
  snapshot: ReservationSnapshot;
  entities: Entity[];
  unitId?: Types.ObjectId;
  /** Fuso da unidade (ou o global). */
  tz: string;
  requiresApproval: boolean;
  /** Tolerância de no-show em minutos (0 = desligado). */
  graceMinutes: number;
}
type TargetIds = { roomId?: string; resourceId?: string; combinationId?: string };

const TARGET_CONFLICT_MSG =
  'Já existe uma reserva neste horário para a sala ou o recurso escolhido.';

const plainSlots = (slots: Slot[]): Slot[] =>
  slots.map(({ weekday, start, end }) => ({ weekday, start, end }));

@Injectable()
export class ReservationsService {
  private readonly tz: string;
  private readonly useTx: boolean;
  /** Limites por pessoa (0 = sem limite). Admin é isento. */
  private readonly limits: { minutesPerDay: number; activeFuture: number; minAdvanceMin: number; maxAdvanceDays: number };

  constructor(
    @InjectModel(Reservation.name) private readonly model: Model<Reservation>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(Resource.name) private readonly resources: Model<Resource>,
    @InjectModel(Combination.name) private readonly combos: Model<Combination>,
    @InjectModel(Unit.name) private readonly units: Model<Unit>,
    private readonly users: UsersService,
    private readonly locks: ReservationLocksService,
    private readonly notifications: NotificationsService,
    private readonly waitlist: WaitlistService,
    @InjectConnection() private readonly conn: Connection,
    config: ConfigService,
  ) {
    this.tz = config.get<string>('APP_TIMEZONE') ?? 'America/Sao_Paulo';
    this.useTx = config.get<string>('USE_TRANSACTIONS') === 'true'; // exige MongoDB em replica set
    const n = (k: string) => Number(config.get(k) ?? 0) || 0;
    this.limits = {
      minutesPerDay: n('LIMIT_MAX_MINUTES_PER_DAY'),
      activeFuture: n('LIMIT_MAX_ACTIVE_FUTURE'),
      minAdvanceMin: n('LIMIT_MIN_ADVANCE_MINUTES'),
      maxAdvanceDays: n('LIMIT_MAX_ADVANCE_DAYS'),
    };
  }

  // ------------------------------------------------------------ consultas

  visibility(user: RequestUser): FilterQuery<Reservation> {
    if (user.role === Role.ADMIN) return {};
    const uid = new Types.ObjectId(user.id);
    // quem consulta só enxerga depois que a reserva foi aprovada (quando exigido)
    const asViewer = {
      'viewers.userId': uid,
      approvalStatus: { $nin: [ApprovalStatus.PENDING, ApprovalStatus.REJECTED, ApprovalStatus.EXPIRED] },
    };
    if (user.role === Role.VIEWER) return asViewer;
    const or: FilterQuery<Reservation>[] = [{ createdBy: uid }, asViewer];
    if (user.role === Role.MANAGER && user.unitIds.length) {
      or.push({ unitId: { $in: user.unitIds.map((i) => new Types.ObjectId(i)) } });
    }
    return { $or: or };
  }

  list(q: QueryReservationsDto, user: RequestUser) {
    const filter: FilterQuery<Reservation> = {
      status: q.status ?? ReservationStatus.ACTIVE,
      ...this.visibility(user),
    };
    if (q.from) filter.end = { $gt: new Date(q.from) };
    if (q.to) filter.start = { $lt: new Date(q.to) };
    if (q.targetType) filter.targetType = q.targetType;
    if (q.roomId) filter.roomId = q.roomId;
    if (q.resourceId) filter.resourceId = q.resourceId;
    if (q.combinationId) filter.combinationId = q.combinationId;
    const { limit, skip } = paginate(q);
    return Promise.all([
      this.model.find(filter).sort({ start: 1 }).skip(skip).limit(limit),
      this.model.countDocuments(filter),
    ]).then(([items, total]) => ({ items, total }));
  }

  async findVisible(id: string, user: RequestUser) {
    const doc = await this.model.findOne({ _id: id, ...this.visibility(user) });
    if (!doc) throw new NotFoundException('Reserva não encontrada');
    return doc;
  }

  /** Horários ocupados (sem dados pessoais) para quem vai marcar. */
  async busy(q: BusyQueryDto) {
    const field = { ROOM: 'roomId', RESOURCE: 'resourceId', COMBINATION: 'combinationId' }[
      q.targetType
    ];
    const target = await this.loadTarget(q.targetType, { [field]: q.targetId });
    const items = await this.model
      .find(this.conflictFilter(target.refs, new Date(q.from), new Date(q.to)))
      .select('start end')
      .sort({ start: 1 })
      .lean();
    return {
      entities: target.entities,
      busy: items.map((i) => ({ start: i.start, end: i.end })),
    };
  }

  // ------------------------------------------------------------ criação

  /**
   * Anti-corrida: as verificações abaixo dão mensagens amigáveis, mas quem
   * decide de verdade é a trava atômica (acquire), baseada em índice único.
   */
  async create(
    dto: CreateReservationDto,
    user: RequestUser,
    extra: { seriesId?: Types.ObjectId; silent?: boolean } = {},
  ) {
    const { start, end } = this.parseInterval(dto.start, dto.end, true);
    const target = await this.loadTarget(dto.targetType, dto);
    if (!inUnitScope(user, target.unitId)) throw new ForbiddenException('Este item pertence a outra unidade.');
    this.assertBookable(target.entities);
    this.assertFits(target.entities, start, end, target.tz);
    await this.assertNoConflict(target.refs, start, end); // também cobre dados anteriores às travas
    await this.assertLimits(user, start, end);
    const viewers = await this.resolveViewers(dto.viewerIds ?? [], user.id);

    // Item sensível: reserva fica PENDING (segura o horário) até um gestor aprovar.
    const approval = !target.requiresApproval
      ? ApprovalStatus.NOT_REQUIRED
      : canAdminUnit(user, target.unitId)
        ? ApprovalStatus.APPROVED
        : ApprovalStatus.PENDING;
    const _id = new Types.ObjectId();
    const keys = targetLockKeys(this.idsOf(target.refs), start, end, this.locks.slotMinutes);
    const payload = {
      _id,
      targetType: dto.targetType,
      ...target.refs,
      start,
      end,
      title: dto.title,
      notes: dto.notes,
      seriesId: extra.seriesId,
      unitId: target.unitId,
      approvalStatus: approval,
      noShowGraceMinutes: target.graceMinutes,
      createdBy: new Types.ObjectId(user.id),
      createdBySnapshot: { name: user.name, email: user.email },
      viewers,
      snapshot: target.snapshot,
    };

    let doc: ReservationDocument;
    if (this.useTx) {
      // Reserva + travas numa transação: tudo ou nada (exige replica set).
      doc = await this.conn.transaction(async (session) => {
        await this.acquireTarget(keys, _id, { session, expireAt: end });
        const [created] = await this.model.create([payload], { session });
        return created;
      });
    } else {
      const token = await this.acquireTarget(keys, _id);
      try {
        doc = await this.model.create(payload);
      } catch (err) {
        await this.locks.releaseByToken(token); // reserva não foi gravada: devolve os blocos
        throw err;
      }
      await this.locks.confirm(token, end); // trava passa a durar até o fim da reserva
    }

    if (approval === ApprovalStatus.PENDING) {
      if (!extra.silent) await this.notifyApprovers(doc);
    } else if (!extra.silent && viewers.length) {
      await this.notifications.notify(viewers.map((v) => v.userId), {
        type: 'RESERVATION_ADDED',
        title: 'Você foi adicionado a uma reserva',
        body: `${doc.title} — ${this.fmt(start)}`,
        data: { reservationId: doc.id },
      });
    }
    return doc;
  }

  async update(id: string, dto: UpdateReservationDto, user: RequestUser) {
    const doc = await this.findForWrite(id, user);

    const set: Record<string, unknown> = {};
    if (dto.title !== undefined) set.title = dto.title;
    if (dto.notes !== undefined) set.notes = dto.notes;

    const timesChanged = dto.start !== undefined || dto.end !== undefined;
    let token: string | undefined;
    let keysToRemove: string[] = [];
    let newEnd = doc.end;

    if (timesChanged) {
      const { start, end } = this.parseInterval(
        dto.start ?? doc.start.toISOString(),
        dto.end ?? doc.end.toISOString(),
        true,
      );
      const target = await this.loadTarget(doc.targetType, {
        roomId: doc.roomId?.toString(),
        resourceId: doc.resourceId?.toString(),
        combinationId: doc.combinationId?.toString(),
      });
      this.assertBookable(target.entities);
      this.assertFits(target.entities, start, end, target.tz);
      await this.assertNoConflict(target.refs, start, end, doc.id);

      // Só trava o que é novo; o que já era desta reserva continua dela.
      const refs = this.idsOf(this.refsOf(doc));
      const slot = this.locks.slotMinutes;
      const oldKeys = new Set(targetLockKeys(refs, doc.start, doc.end, slot));
      const newKeys = targetLockKeys(refs, start, end, slot);
      const newSet = new Set(newKeys);
      keysToRemove = [...oldKeys].filter((k) => !newSet.has(k));
      token = await this.acquireTarget(
        newKeys.filter((k) => !oldKeys.has(k)),
        doc._id,
      );
      set.start = start;
      set.end = end;
      newEnd = end;
      if (target.requiresApproval && !canAdminUnit(user, target.unitId)) set.approvalStatus = ApprovalStatus.PENDING;
    }

    if (!Object.keys(set).length) return doc;

    const filter: FilterQuery<Reservation> = { _id: doc._id, status: ReservationStatus.ACTIVE };
    if (timesChanged) {
      // Se outra remarcação passou na frente, esta falha (e devolve as travas).
      filter.start = doc.start;
      filter.end = doc.end;
    }
    const update: UpdateQuery<Reservation> = { $set: set };
    // Remarcou: as confirmações de presença deixam de valer e precisam ser refeitas.
    if (timesChanged) update.$unset = { 'viewers.$[].confirmedAt': '' };

    let updated: ReservationDocument | null;
    try {
      updated = await this.model.findOneAndUpdate(filter, update, { new: true });
    } catch (err) {
      if (token) await this.locks.releaseByToken(token);
      throw err;
    }
    if (!updated) {
      if (token) await this.locks.releaseByToken(token);
      throw new ConflictException('A reserva foi alterada por outra pessoa. Recarregue e tente de novo.');
    }

    if (timesChanged) {
      await this.locks.releaseKeys(keysToRemove, doc._id);
      await this.locks.releaseAttendance(doc._id);
      await this.locks.extendReservation(doc._id, newEnd);
      await this.afterFreed(doc, user, 'remarcada');
    }
    if (set.approvalStatus === ApprovalStatus.PENDING) await this.notifyApprovers(updated);
    return updated;
  }

  async cancel(
    id: string,
    user: RequestUser,
    opts: { silent?: boolean; reason?: CancelReason; note?: string } = {},
  ) {
    const doc = await this.findForWrite(id, user);
    doc.status = ReservationStatus.CANCELLED;
    doc.cancelledAt = new Date();
    doc.cancelledBy = new Types.ObjectId(user.id);
    doc.cancelReason = opts.reason ?? CancelReason.USER;
    await doc.save();
    // Primeiro o status, depois as travas: se cair no meio, o pior caso é um
    // bloqueio a mais até o TTL — nunca uma reserva ativa sem trava.
    await this.locks.releaseReservation(doc._id);
    if (!opts.silent) await this.afterFreed(doc, user, 'cancelada', opts.note);
    return doc;
  }

  // ------------------------------------------------------------ quem consulta

  async addViewers(id: string, dto: AddViewersDto, user: RequestUser) {
    const doc = await this.findForWrite(id, user);
    const viewers = await this.resolveViewers(dto.userIds, doc.createdBy.toString());
    const added: Types.ObjectId[] = [];
    for (const v of viewers) {
      if (!doc.viewers.some((x) => x.userId.equals(v.userId))) {
        doc.viewers.push(v);
        added.push(v.userId);
      }
    }
    const saved = await doc.save();
    await this.notifications.notify(added, {
      type: 'RESERVATION_ADDED',
      title: 'Você foi adicionado a uma reserva',
      body: `${doc.title} — ${this.fmt(doc.start)}`,
      data: { reservationId: doc.id },
    });
    return saved;
  }

  async removeViewer(id: string, userId: string, user: RequestUser) {
    const doc = await this.findForWrite(id, user);
    const uid = new Types.ObjectId(userId);
    const updated = await this.model.findOneAndUpdate(
      { _id: doc._id },
      { $pull: { viewers: { userId: uid } } },
      { new: true },
    );
    await this.locks.releaseAttendance(doc._id, uid); // quem sai deixa de ocupar o próprio tempo
    return updated ?? doc;
  }

  // ------------------------------------------------------------ presença

  /**
   * A própria pessoa confirma presença. Não pode confirmar duas reservas que se
   * sobrepõem no tempo (mesmo em salas/recursos diferentes). Idempotente.
   */
  async confirmAttendance(id: string, user: RequestUser) {
    const userId = new Types.ObjectId(user.id);
    const doc = await this.model.findOne({ _id: id, 'viewers.userId': userId });
    if (!doc) throw new NotFoundException('Reserva não encontrada');
    if (doc.status !== ReservationStatus.ACTIVE) {
      throw new ConflictException('Esta reserva foi cancelada.');
    }
    if (doc.approvalStatus === ApprovalStatus.PENDING) {
      throw new ConflictException('Esta reserva ainda aguarda aprovação.');
    }
    if (doc.end.getTime() <= Date.now()) {
      throw new ConflictException('Esta reserva já terminou.');
    }
    const mine = doc.viewers.find((v) => v.userId.equals(userId));
    if (mine?.confirmedAt) return doc; // já confirmada

    // 1) verificação amigável (diz qual reserva atrapalha)
    const clash = await this.model.findOne({
      _id: { $ne: doc._id },
      status: ReservationStatus.ACTIVE,
      start: { $lt: doc.end },
      end: { $gt: doc.start },
      viewers: { $elemMatch: { userId, confirmedAt: { $ne: null } } },
    } as FilterQuery<Reservation>);
    if (clash) {
      throw new ConflictException(
        `Você já confirmou presença em "${clash.title}" (${this.fmt(clash.start)} – ${this.fmt(clash.end)}), no mesmo horário.`,
      );
    }

    // 2) trava atômica do tempo da pessoa (decide quando há confirmações simultâneas)
    const keys = userLockKeys(user.id, doc.start, doc.end, this.locks.slotMinutes);
    let token: string;
    try {
      token = await this.locks.acquire(keys, { reservationId: doc._id, userId });
    } catch (err) {
      if (!(err instanceof LockConflictError)) throw err;
      if (await this.locks.ownedBy(keys, doc._id, userId)) {
        return (await this.model.findById(doc._id)) ?? doc; // requisição duplicada
      }
      throw new ConflictException(
        'Conflito de horário: você acabou de confirmar presença em outra reserva no mesmo horário.',
      );
    }

    // 3) grava a confirmação só se a reserva continua igual (ativa, mesmo horário)
    let updated: ReservationDocument | null;
    try {
      updated = await this.model.findOneAndUpdate(
        {
          _id: doc._id,
          status: ReservationStatus.ACTIVE,
          start: doc.start,
          end: doc.end,
          'viewers.userId': userId,
        },
        { $set: { 'viewers.$.confirmedAt': new Date() } },
        { new: true },
      );
    } catch (err) {
      await this.locks.releaseByToken(token);
      throw err;
    }
    if (!updated) {
      await this.locks.releaseByToken(token);
      throw new ConflictException('A reserva mudou enquanto você confirmava. Tente de novo.');
    }
    await this.locks.confirm(token, doc.end);
    return updated;
  }

  async cancelAttendance(id: string, user: RequestUser) {
    const userId = new Types.ObjectId(user.id);
    const updated = await this.model.findOneAndUpdate(
      { _id: id, 'viewers.userId': userId },
      { $unset: { 'viewers.$.confirmedAt': '' } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Reserva não encontrada');
    await this.locks.releaseAttendance(updated._id, userId);
    return updated;
  }

  // ------------------------------------------------------------ internos

  private async findForWrite(id: string, user: RequestUser) {
    const doc = await this.model.findById(id);
    if (!doc) throw new NotFoundException('Reserva não encontrada');
    if (!canAdminUnit(user, doc.unitId) && doc.createdBy.toString() !== user.id) {
      throw new ForbiddenException('Apenas quem fez a marcação (ou o admin) pode alterá-la.');
    }
    if (doc.status !== ReservationStatus.ACTIVE) {
      throw new ConflictException('Esta reserva já foi cancelada.');
    }
    return doc;
  }

  private async resolveViewers(ids: string[], ownerId: string) {
    const unique = [...new Set(ids)].filter((i) => i !== ownerId);
    if (!unique.length) return [];
    const users = await this.users.findActiveByIds(unique);
    if (users.length !== unique.length) {
      throw new BadRequestException('Algum usuário informado não existe ou está inativo.');
    }
    return users.map((u) => ({ userId: u._id, name: u.name, email: u.email }));
  }

  private parseInterval(startIso: string, endIso: string, requireFuture: boolean) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (isNaN(+start) || isNaN(+end)) throw new BadRequestException('Datas inválidas.');
    if (end <= start) throw new BadRequestException('O fim deve ser posterior ao início.');
    const minutes = this.locks.slotMinutes;
    const block = minutes * 60_000;
    if (+start % block || +end % block) {
      throw new BadRequestException(
        `Use horários múltiplos de ${minutes} minutos (ex.: 09:00, 09:${String(minutes).padStart(2, '0')}).`,
      );
    }
    if (requireFuture && +start < Date.now()) {
      throw new BadRequestException('Não é possível reservar no passado.');
    }
    return { start, end };
  }

  private refsOf(doc: ReservationDocument): Refs {
    return { roomId: doc.roomId, resourceId: doc.resourceId, combinationId: doc.combinationId };
  }

  private idsOf(refs: Refs) {
    return { roomId: refs.roomId?.toString(), resourceId: refs.resourceId?.toString() };
  }

  private async acquireTarget(
    keys: string[],
    reservationId: Types.ObjectId,
    opts: { session?: ClientSession; expireAt?: Date } = {},
  ): Promise<string> {
    try {
      return await this.locks.acquire(keys, { reservationId }, opts);
    } catch (err) {
      if (err instanceof LockConflictError) throw new ConflictException(TARGET_CONFLICT_MSG);
      throw err;
    }
  }

  private fmt(d: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: this.tz,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d);
  }

  private async loadTarget(type: TargetType, ids: TargetIds): Promise<LoadedTarget> {
    const base = await this.loadTargetBase(type, ids);
    const [room, res, combo] = await Promise.all([
      base.refs.roomId ? this.rooms.findById(base.refs.roomId) : null,
      base.refs.resourceId ? this.resources.findById(base.refs.resourceId) : null,
      base.refs.combinationId ? this.combos.findById(base.refs.combinationId) : null,
    ]);
    const unitId = (combo ?? room ?? res)?.unitId;
    const unit = unitId ? await this.units.findById(unitId) : null;
    const graces = [room?.noShowGraceMinutes, res?.noShowGraceMinutes].filter((g): g is number => !!g && g > 0);
    return {
      ...base,
      unitId,
      tz: unit?.timezone || this.tz,
      requiresApproval: !!(room?.requiresApproval || res?.requiresApproval || combo?.requiresApproval),
      graceMinutes: graces.length ? Math.min(...graces) : (unit?.noShowGraceMinutes ?? 0),
    };
  }

  private async loadTargetBase(
    type: TargetType,
    ids: TargetIds,
  ): Promise<Omit<LoadedTarget, 'unitId' | 'tz' | 'requiresApproval' | 'graceMinutes'>> {
    switch (type) {
      case TargetType.ROOM: {
        const room = await this.rooms.findById(ids.roomId);
        if (!room) throw new NotFoundException('Sala não encontrada');
        return {
          refs: { roomId: room._id },
          snapshot: { room: this.snapRoom(room) },
          entities: [this.entity(`Sala "${room.name}"`, room)],
        };
      }
      case TargetType.RESOURCE: {
        const res = await this.resources.findById(ids.resourceId);
        if (!res) throw new NotFoundException('Recurso não encontrado');
        return {
          refs: { resourceId: res._id },
          snapshot: { resource: this.snapResource(res) },
          entities: [this.entity(`Recurso "${res.name}"`, res)],
        };
      }
      case TargetType.COMBINATION: {
        const combo = await this.combos.findById(ids.combinationId);
        if (!combo) throw new NotFoundException('Combinação não encontrada');
        const [room, res] = await Promise.all([
          this.rooms.findById(combo.room),
          this.resources.findById(combo.resource),
        ]);
        if (!room || !res) throw new NotFoundException('Sala ou recurso da combinação não existe mais');
        return {
          refs: { roomId: room._id, resourceId: res._id, combinationId: combo._id },
          snapshot: {
            room: this.snapRoom(room),
            resource: this.snapResource(res),
            combination: {
              id: combo.id,
              notes: combo.notes,
              availability: plainSlots(combo.availability),
            },
          },
          // A combinação precisa respeitar a própria agenda E a da sala e do recurso.
          entities: [
            this.entity(`Combinação "${room.name} + ${res.name}"`, combo),
            this.entity(`Sala "${room.name}"`, room),
            this.entity(`Recurso "${res.name}"`, res),
          ],
        };
      }
    }
  }

  private entity(
    label: string,
    e: { status: AvailabilityStatus; statusNote?: string; availability: Slot[] },
  ): Entity {
    return {
      label,
      status: e.status,
      statusNote: e.statusNote,
      availability: plainSlots(e.availability),
    };
  }

  private snapRoom(r: any): SnapshotEntity {
    return {
      id: r.id,
      name: r.name,
      location: r.location,
      capacity: r.capacity,
      description: r.description,
      availability: plainSlots(r.availability),
    };
  }

  private snapResource(r: any): SnapshotEntity {
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      description: r.description,
      availability: plainSlots(r.availability),
    };
  }

  private assertBookable(entities: Entity[]) {
    for (const e of entities) {
      if (e.status !== AvailabilityStatus.AVAILABLE) {
        const note = e.statusNote ? `: ${e.statusNote}` : '';
        throw new ConflictException(`${e.label} está ${STATUS_LABEL[e.status]}${note}`);
      }
    }
  }

  private assertFits(entities: Entity[], start: Date, end: Date, tz: string = this.tz) {
    if (endMinutesOnStartDay(start, end, tz) === null) {
      throw new BadRequestException('A reserva deve começar e terminar no mesmo dia.');
    }
    for (const e of entities) {
      if (!fitsInAvailability(e.availability, start, end, tz)) {
        throw new BadRequestException(`O horário está fora da disponibilidade de ${e.label}.`);
      }
    }
  }

  private conflictFilter(
    refs: Refs,
    start: Date,
    end: Date,
    excludeId?: string,
  ): FilterQuery<Reservation> {
    const or: FilterQuery<Reservation>[] = [];
    if (refs.roomId) or.push({ roomId: refs.roomId });
    if (refs.resourceId) or.push({ resourceId: refs.resourceId });
    const filter: FilterQuery<Reservation> = {
      status: ReservationStatus.ACTIVE,
      start: { $lt: end },
      end: { $gt: start },
      $or: or,
    };
    if (excludeId) filter._id = { $ne: excludeId };
    return filter;
  }

  private async assertNoConflict(refs: Refs, start: Date, end: Date, excludeId?: string) {
    const clash = await this.model.exists(this.conflictFilter(refs, start, end, excludeId));
    if (clash) throw new ConflictException(TARGET_CONFLICT_MSG);
  }

  /** Limites por pessoa (configuráveis por env; 0 = desligado; admin é isento). */
  private async assertLimits(user: RequestUser, start: Date, end: Date) {
    if (user.role === Role.ADMIN || user.role === Role.MANAGER) return;
    const L = this.limits;
    const now = Date.now();
    if (L.minAdvanceMin && +start - now < L.minAdvanceMin * 60_000) {
      throw new BadRequestException(`Reserve com pelo menos ${L.minAdvanceMin} minutos de antecedência.`);
    }
    if (L.maxAdvanceDays && +start - now > L.maxAdvanceDays * 86_400_000) {
      throw new BadRequestException(`Só é possível reservar com até ${L.maxAdvanceDays} dias de antecedência.`);
    }
    const createdBy = new Types.ObjectId(user.id);
    if (L.activeFuture) {
      const n = await this.model.countDocuments({ createdBy, status: ReservationStatus.ACTIVE, end: { $gt: new Date() } });
      if (n >= L.activeFuture) {
        throw new ConflictException(`Limite de ${L.activeFuture} reservas futuras ativas atingido.`);
      }
    }
    if (L.minutesPerDay) {
      const dayStart = new Date(+start - localParts(start, this.tz).minutes * 60_000);
      const dayEnd = new Date(+dayStart + 86_400_000);
      const same = await this.model
        .find({ createdBy, status: ReservationStatus.ACTIVE, start: { $gte: dayStart, $lt: dayEnd } })
        .select('start end')
        .lean();
      const used = same.reduce((sum, r) => sum + (+r.end - +r.start) / 60_000, 0);
      const wanted = (+end - +start) / 60_000;
      if (used + wanted > L.minutesPerDay) {
        throw new ConflictException(`Limite de ${L.minutesPerDay / 60}h de reservas por dia excedido.`);
      }
    }
  }

  /** Avisa quem é afetado e a lista de espera quando um horário é liberado. Nunca falha a operação. */
  private async afterFreed(doc: ReservationDocument, actor: RequestUser, what: 'cancelada' | 'remarcada', note?: string) {
    try {
      const ids = new Set<string>([doc.createdBy.toString(), ...doc.viewers.map((v) => v.userId.toString())]);
      ids.delete(actor.id);
      await this.notifications.notify([...ids], {
        type: what === 'cancelada' ? 'RESERVATION_CANCELLED' : 'RESERVATION_RESCHEDULED',
        title: `Reserva ${what}`,
        body: `"${doc.title}" de ${this.fmt(doc.start)} foi ${what} por ${actor.name}.${note ? ` ${note}` : ''}`,
        data: { reservationId: doc.id },
      });
      await this.waitlist.onFreed(this.refsOf(doc), doc.start, doc.end);
    } catch {
      /* ignora */
    }
  }

  /** Avisa admins e gestores da unidade que há reserva aguardando decisão. */
  async notifyApprovers(doc: ReservationDocument) {
    try {
      const approvers = await this.users.findApprovers(doc.unitId?.toString());
      const ids = approvers.map((a) => a._id).filter((id) => !id.equals(doc.createdBy));
      await this.notifications.notify(ids, {
        type: 'APPROVAL_REQUESTED',
        title: 'Reserva aguardando aprovação',
        body: `"${doc.title}" — ${this.fmt(doc.start)}, solicitada por ${doc.createdBySnapshot.name}.`,
        data: { reservationId: doc.id },
      });
    } catch {
      /* aviso nunca derruba a operação */
    }
  }
}
