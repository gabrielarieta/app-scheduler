import { ReservationsModule } from '../reservations/reservations.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Combination, CombinationSchema } from '../combinations/combination.schema';
import { Reservation, ReservationSchema } from '../reservations/reservation.schema';
import { Resource, ResourceSchema } from './resource.schema';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

@Module({
  imports: [
    ReservationsModule,
    MongooseModule.forFeature([
      { name: Resource.name, schema: ResourceSchema },
      { name: Reservation.name, schema: ReservationSchema },
      { name: Combination.name, schema: CombinationSchema },
    ]),
  ],
  controllers: [ResourcesController],
  providers: [ResourcesService],
})
export class ResourcesModule {}
