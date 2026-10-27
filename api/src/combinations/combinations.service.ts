import { assertUnitWrite, inUnitScope, unitScopeFilter } from '../common/scope';
import { ReservationsExtrasService } from '../reservations/reservations-extras.service';
import { RequestUser } from '../common/decorators';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateStatusDto } from '../common/availability.dto';
import { assertValidSlots } from '../common/availability.util';
import { AvailabilityStatus, ReservationStatus } from '../common/enums';
import { Reservation } from '../reservations/reservation.schema';
import { Resource } from '../resources/resource.schema';
import { Room } from '../rooms/room.schema';
import { Combination } from './combination.schema';
import { CreateCombinationDto, UpdateCombinationDto } from './combinations.dto';

@Injectable()
export class CombinationsService {
  constructor(
    private readonly impact: ReservationsExtrasService,
    @InjectModel(Combination.name) private readonly model: Model<Combination>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(Resource.name) private readonly resources: Model<Resource>,
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
  ) {}

  private populate<T extends { populate: (...a: any[]) => any }>(q: T) {
    return q.populate('room', 'name location capacity status').populate('resource', 'name type status');
  }

  list(user: RequestUser, roomId?: string, resourceId?: string, status?: AvailabilityStatus) {
    const filter: Record<string, unknown> = { ...unitScopeFilter(user) };
    if (roomId) filter.room = roomId;
    if (resourceId) filter.resource = resourceId;
    if (status) filter.status = status;
    return this.populate(this.model.find(filter));
  }

  async get(id: string) {
    const doc = await this.populate(this.model.findById(id));
    if (!doc) throw new NotFoundException('Combinação não encontrada');
    return doc;
  }

  async getVisible(id: string, user: RequestUser) {
    const doc = await this.get(id);
    if (!inUnitScope(user, doc.unitId)) throw new NotFoundException('Combinação não encontrada');
    return doc;
  }

  async create(dto: CreateCombinationDto, actor: RequestUser) {
    assertValidSlots(dto.availability);
    const room = await this.rooms.findById(dto.roomId);
    if (!room) throw new NotFoundException('Sala não encontrada');
    const res = await this.resources.findById(dto.resourceId);
    if (!res) throw new NotFoundException('Recurso não encontrado');
    if (String(room.unitId ?? '') !== String(res.unitId ?? '')) {
      throw new BadRequestException('Sala e recurso precisam ser da mesma unidade.');
    }
    assertUnitWrite(actor, room.unitId);
    const doc = await this.model.create({
      room: dto.roomId,
      resource: dto.resourceId,
      notes: dto.notes,
      availability: dto.availability,
      unitId: room.unitId,
      requiresApproval: dto.requiresApproval ?? false,
    });
    return this.get(doc.id);
  }

  async update(id: string, dto: UpdateCombinationDto, actor: RequestUser) {
    assertUnitWrite(actor, (await this.get(id)).unitId);
    if (dto.availability) assertValidSlots(dto.availability);
    const doc = await this.model.findByIdAndUpdate(id, dto, { new: true, runValidators: true });
    if (!doc) throw new NotFoundException('Combinação não encontrada');
    return this.get(id);
  }

  async setStatus(id: string, dto: UpdateStatusDto, actor: RequestUser) {
    const doc = await this.model.findById(id);
    if (!doc) throw new NotFoundException('Combinação não encontrada');
    assertUnitWrite(actor, doc.unitId);
    doc.status = dto.status;
    doc.statusNote = dto.status === AvailabilityStatus.AVAILABLE ? undefined : dto.statusNote;
    await doc.save();
    const impact = await this.impact.onTargetStatusChange(
      'combinationId', id, 'Combinação', dto.status, dto.statusNote, !!dto.cancelAffectedReservations, actor,
    );
    return { ...(await this.get(id)).toJSON(), ...impact };
  }

  async remove(id: string, actor: RequestUser) {
    const doc = await this.model.findById(id);
    if (!doc) throw new NotFoundException('Combinação não encontrada');
    assertUnitWrite(actor, doc.unitId);
    if (await this.futureCount(id)) {
      throw new ConflictException('Há reservas futuras para esta combinação. Cancele-as antes de excluir.');
    }
    await doc.deleteOne();
  }

  private futureCount(id: string) {
    return this.reservations.countDocuments({
      combinationId: id,
      status: ReservationStatus.ACTIVE,
      end: { $gt: new Date() },
    });
  }
}
