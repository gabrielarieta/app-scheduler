import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Resource, ResourceSchema } from '../resources/resource.schema';
import { Room, RoomSchema } from '../rooms/room.schema';
import { Unit, UnitSchema } from './unit.schema';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Unit.name, schema: UnitSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Resource.name, schema: ResourceSchema },
    ]),
  ],
  controllers: [UnitsController],
  providers: [UnitsService],
})
export class UnitsModule {}
