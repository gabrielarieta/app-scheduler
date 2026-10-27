import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Combination, CombinationSchema } from '../combinations/combination.schema';
import { Reservation, ReservationSchema } from '../reservations/reservation.schema';
import { Resource, ResourceSchema } from '../resources/resource.schema';
import { Room, RoomSchema } from '../rooms/room.schema';
import { WaitlistController } from './waitlist.controller';
import { WaitlistEntry, WaitlistEntrySchema } from './waitlist.schema';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WaitlistEntry.name, schema: WaitlistEntrySchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Resource.name, schema: ResourceSchema },
      { name: Combination.name, schema: CombinationSchema },
    ]),
  ],
  controllers: [WaitlistController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
