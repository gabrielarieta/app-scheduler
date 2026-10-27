import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { AvailabilityStatus } from './enums';

export const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const END_TIME_RE = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;

export class AvailabilitySlotDto {
  /** 0 = domingo ... 6 = sábado */
  @IsInt()
  @Min(0)
  @Max(6)
  weekday: number;

  /** "HH:mm" */
  @Matches(TIME_RE, { message: 'start deve estar no formato HH:mm' })
  start: string;

  /** "HH:mm" ou "24:00" */
  @Matches(END_TIME_RE, { message: 'end deve estar no formato HH:mm' })
  end: string;
}

export class UpdateStatusDto {
  @IsEnum(AvailabilityStatus)
  status: AvailabilityStatus;

  /** Motivo (ex.: "Troca do projetor até dia 15") */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  statusNote?: string;

  /** Cancela as reservas futuras afetadas (e avisa as pessoas). Padrão: só avisa. */
  @IsOptional()
  @IsBoolean()
  cancelAffectedReservations?: boolean;
}
