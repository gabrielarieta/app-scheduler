import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Combination, CombinationSchema } from '../combinations/combination.schema';
import { Resource, ResourceSchema } from '../resources/resource.schema';
import { Room, RoomSchema } from '../rooms/room.schema';
import { Unit, UnitSchema } from '../units/unit.schema';
import { UsersModule } from '../users/users.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { IdempotencyKey, IdempotencyKeySchema, IdempotencyService } from './idempotency.service';
import { ReservationLock, ReservationLockSchema } from './reservation-lock.schema';
import { ReservationLocksService } from './reservation-locks.service';
import { Reservation, ReservationSchema } from './reservation.schema';
import { ReservationsController } from './reservations.controller';
import { ReservationsExtrasService } from './reservations-extras.service';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [
    UsersModule,
    WaitlistModule,
    MongooseModule.forFeature([
      { name: Reservation.name, schema: ReservationSchema },
      { name: ReservationLock.name, schema: ReservationLockSchema },
      { name: IdempotencyKey.name, schema: IdempotencyKeySchema },
      { name: Room.name, schema: RoomSchema },
      { name: Resource.name, schema: ResourceSchema },
      { name: Combination.name, schema: CombinationSchema },
      { name: Unit.name, schema: UnitSchema },
    ]),
  ],
  controllers: [ReservationsController],
  providers: [ReservationsService, ReservationLocksService, ReservationsExtrasService, IdempotencyService],
  exports: [ReservationsService, ReservationsExtrasService],
})
export class ReservationsModule {}
