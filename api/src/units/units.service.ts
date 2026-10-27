import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RequestUser } from '../common/decorators';
import { Role } from '../common/enums';
import { Resource } from '../resources/resource.schema';
import { Room } from '../rooms/room.schema';
import { CreateUnitDto, UpdateUnitDto } from './units.dto';
import { Unit } from './unit.schema';

function checkTz(tz?: string) {
  if (!tz) return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new BadRequestException(`Fuso horário inválido: ${tz}`);
  }
}

@Injectable()
export class UnitsService {
  constructor(
    @InjectModel(Unit.name) private readonly model: Model<Unit>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(Resource.name) private readonly resources: Model<Resource>,
  ) {}

  list(user: RequestUser) {
    return this.model.find(user.role === Role.ADMIN ? {} : { _id: { $in: user.unitIds } }).sort({ name: 1 });
  }

  create(dto: CreateUnitDto) {
    checkTz(dto.timezone);
    return this.model.create(dto);
  }

  async update(id: string, dto: UpdateUnitDto) {
    checkTz(dto.timezone);
    const doc = await this.model.findByIdAndUpdate(id, dto, { new: true, runValidators: true });
    if (!doc) throw new NotFoundException('Unidade não encontrada');
    return doc;
  }

  async remove(id: string) {
    if ((await this.rooms.exists({ unitId: id })) || (await this.resources.exists({ unitId: id }))) {
      throw new ConflictException('Há salas ou recursos nesta unidade. Mova ou exclua-os primeiro.');
    }
    const r = await this.model.deleteOne({ _id: id });
    if (!r.deletedCount) throw new NotFoundException('Unidade não encontrada');
  }
}
