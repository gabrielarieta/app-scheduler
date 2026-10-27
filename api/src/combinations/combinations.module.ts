import { ReservationsModule } from '../reservations/reservations.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Reservation, ReservationSchema } from '../reservations/reservation.schema';
import { Resource, ResourceSchema } from '../resources/resource.schema';
import { Room, RoomSchema } from '../rooms/room.schema';
import { Combination, CombinationSchema } from './combination.schema';
import { CombinationsController } from './combinations.controller';
import { CombinationsService } from './combinations.service';

@Module({
  imports: [
    ReservationsModule,
    MongooseModule.forFeature([
      { name: Combination.name, schema: CombinationSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Resource.name, schema: ResourceSchema },
      { name: Reservation.name, schema: ReservationSchema },
    ]),
  ],
  controllers: [CombinationsController],
  providers: [CombinationsService],
})
export class CombinationsModule {}
