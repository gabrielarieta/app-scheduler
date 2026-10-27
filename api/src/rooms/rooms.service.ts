import { assertUnitWrite, inUnitScope, unitScopeFilter } from '../common/scope';
import { ReservationsExtrasService } from '../reservations/reservations-extras.service';
import { RequestUser } from '../common/decorators';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateStatusDto } from '../common/availability.dto';
import { assertValidSlots } from '../common/availability.util';
import { AvailabilityStatus, ReservationStatus } from '../common/enums';
import { Combination } from '../combinations/combination.schema';
import { Reservation } from '../reservations/reservation.schema';
import { Room } from './room.schema';
import { CreateRoomDto, UpdateRoomDto } from './rooms.dto';

@Injectable()
export class RoomsService {
  constructor(
    private readonly impact: ReservationsExtrasService,
    @InjectModel(Room.name) private readonly model: Model<Room>,
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    @InjectModel(Combination.name) private readonly combos: Model<Combination>,
  ) {}

  list(user: RequestUser, status?: AvailabilityStatus) {
    return this.model.find({ ...(status ? { status } : {}), ...unitScopeFilter(user) }).sort({ name: 1 });
  }

  async get(id: string) {
    const doc = await this.model.findById(id);
    if (!doc) throw new NotFoundException('Sala não encontrada');
    return doc;
  }

  async getVisible(id: string, user: RequestUser) {
    const doc = await this.get(id);
    if (!inUnitScope(user, doc.unitId)) throw new NotFoundException('Sala não encontrada');
    return doc;
  }

  create(dto: CreateRoomDto, actor: RequestUser) {
    assertUnitWrite(actor, dto.unitId);
    assertValidSlots(dto.availability);
    return this.model.create(dto);
  }

  async update(id: string, dto: UpdateRoomDto, actor: RequestUser) {
    assertUnitWrite(actor, (await this.get(id)).unitId);
    if (dto.unitId) assertUnitWrite(actor, dto.unitId);
    if (dto.availability) assertValidSlots(dto.availability);
    const doc = await this.model.findByIdAndUpdate(id, dto, { new: true, runValidators: true });
    if (!doc) throw new NotFoundException('Sala não encontrada');
    return doc;
  }

  /** Manutenção/indisponibilidade. Informa quantas reservas futuras ficam afetadas. */
  async setStatus(id: string, dto: UpdateStatusDto, actor: RequestUser) {
    const doc = await this.get(id);
    assertUnitWrite(actor, doc.unitId);
    doc.status = dto.status;
    doc.statusNote = dto.status === AvailabilityStatus.AVAILABLE ? undefined : dto.statusNote;
    await doc.save();
    const impact = await this.impact.onTargetStatusChange(
      'roomId', id, `Sala "${doc.name}"`, dto.status, dto.statusNote, !!dto.cancelAffectedReservations, actor,
    );
    return { ...doc.toJSON(), ...impact };
  }

  async remove(id: string, actor: RequestUser) {
    const doc = await this.get(id);
    assertUnitWrite(actor, doc.unitId);
    if (await this.futureCount(id)) {
      throw new ConflictException('Há reservas futuras para esta sala. Cancele-as antes de excluir.');
    }
    if (await this.combos.exists({ room: doc._id })) {
      throw new ConflictException('Esta sala participa de combinações. Exclua as combinações primeiro.');
    }
    await doc.deleteOne(); // reservas antigas mantêm o snapshot
  }

  private futureCount(id: string) {
    return this.reservations.countDocuments({
      roomId: id,
      status: ReservationStatus.ACTIVE,
      end: { $gt: new Date() },
    });
  }
}
