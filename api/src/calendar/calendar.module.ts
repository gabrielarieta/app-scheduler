import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Reservation, ReservationSchema } from '../reservations/reservation.schema';
import { ReservationsModule } from '../reservations/reservations.module';
import { UsersModule } from '../users/users.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [UsersModule, ReservationsModule, MongooseModule.forFeature([{ name: Reservation.name, schema: ReservationSchema }])],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
