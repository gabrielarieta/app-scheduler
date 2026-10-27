import { ReservationsModule } from '../reservations/reservations.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Combination, CombinationSchema } from '../combinations/combination.schema';
import { Reservation, ReservationSchema } from '../reservations/reservation.schema';
import { Room, RoomSchema } from './room.schema';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

@Module({
  imports: [
    ReservationsModule,
    MongooseModule.forFeature([
      { name: Room.name, schema: RoomSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: Combination.name, schema: CombinationSchema },
    ]),
  ],
  controllers: [RoomsController],
  providers: [RoomsService],
})
export class RoomsModule {}
