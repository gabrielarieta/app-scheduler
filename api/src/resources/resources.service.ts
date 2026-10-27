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
import { Resource } from './resource.schema';
import { CreateResourceDto, UpdateResourceDto } from './resources.dto';

@Injectable()
export class ResourcesService {
  constructor(
    private readonly impact: ReservationsExtrasService,
    @InjectModel(Resource.name) private readonly model: Model<Resource>,
    @InjectModel(Reservation.name) private readonly reservations: Model<Reservation>,
    @InjectModel(Combination.name) private readonly combos: Model<Combination>,
  ) {}

  list(user: RequestUser, status?: AvailabilityStatus, type?: string) {
    const filter: Record<string, unknown> = { ...unitScopeFilter(user) };
    if (status) filter.status = status;
    if (type) filter.type = type;
    return this.model.find(filter).sort({ type: 1, name: 1 });
  }

  async get(id: string) {
    const doc = await this.model.findById(id);
    if (!doc) throw new NotFoundException('Recurso não encontrado');
    return doc;
  }

  async getVisible(id: string, user: RequestUser) {
    const doc = await this.get(id);
    if (!inUnitScope(user, doc.unitId)) throw new NotFoundException('Recurso não encontrado');
    return doc;
  }

  create(dto: CreateResourceDto, actor: RequestUser) {
    assertUnitWrite(actor, dto.unitId);
    assertValidSlots(dto.availability);
    return this.model.create(dto);
  }

  async update(id: string, dto: UpdateResourceDto, actor: RequestUser) {
    assertUnitWrite(actor, (await this.get(id)).unitId);
    if (dto.unitId) assertUnitWrite(actor, dto.unitId);
    if (dto.availability) assertValidSlots(dto.availability);
    const doc = await this.model.findByIdAndUpdate(id, dto, { new: true, runValidators: true });
    if (!doc) throw new NotFoundException('Recurso não encontrado');
    return doc;
  }

  async setStatus(id: string, dto: UpdateStatusDto, actor: RequestUser) {
    const doc = await this.get(id);
    assertUnitWrite(actor, doc.unitId);
    doc.status = dto.status;
    doc.statusNote = dto.status === AvailabilityStatus.AVAILABLE ? undefined : dto.statusNote;
    await doc.save();
    const impact = await this.impact.onTargetStatusChange(
      'resourceId', id, `Recurso "${doc.name}"`, dto.status, dto.statusNote, !!dto.cancelAffectedReservations, actor,
    );
    return { ...doc.toJSON(), ...impact };
  }

  async remove(id: string, actor: RequestUser) {
    const doc = await this.get(id);
    assertUnitWrite(actor, doc.unitId);
    if (await this.futureCount(id)) {
      throw new ConflictException('Há reservas futuras para este recurso. Cancele-as antes de excluir.');
    }
    if (await this.combos.exists({ resource: doc._id })) {
      throw new ConflictException('Este recurso participa de combinações. Exclua as combinações primeiro.');
    }
    await doc.deleteOne();
  }

  private futureCount(id: string) {
    return this.reservations.countDocuments({
      resourceId: id,
      status: ReservationStatus.ACTIVE,
      end: { $gt: new Date() },
    });
  }
}
