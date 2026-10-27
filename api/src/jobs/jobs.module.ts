import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Reservation, ReservationSchema } from '../reservations/reservation.schema';
import { ReservationsModule } from '../reservations/reservations.module';
import { JobLease, JobLeaseSchema } from './job-lease.schema';
import { JobsService } from './jobs.service';

@Module({
  imports: [
    ReservationsModule,
    MongooseModule.forFeature([
      { name: Reservation.name, schema: ReservationSchema },
      { name: JobLease.name, schema: JobLeaseSchema },
    ]),
  ],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
