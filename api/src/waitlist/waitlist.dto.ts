import { PickType } from '@nestjs/swagger';
import { CreateReservationDto } from '../reservations/reservations.dto';

export class JoinWaitlistDto extends PickType(CreateReservationDto, [
  'targetType',
  'roomId',
  'resourceId',
  'combinationId',
  'start',
  'end',
] as const) {}
