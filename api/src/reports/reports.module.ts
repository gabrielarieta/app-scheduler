import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Reservation, ReservationSchema } from '../reservations/reservation.schema';
import { Resource, ResourceSchema } from '../resources/resource.schema';
import { Room, RoomSchema } from '../rooms/room.schema';
import { Unit, UnitSchema } from '../units/unit.schema';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Reservation.name, schema: ReservationSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Resource.name, schema: ResourceSchema },
      { name: Unit.name, schema: UnitSchema },
    ]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
