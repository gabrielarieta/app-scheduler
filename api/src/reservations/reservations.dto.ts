import { Type } from 'class-transformer';
import { IsIn, IsInt, Length, Max, Min } from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ReservationStatus, TargetType } from '../common/enums';

export class CreateReservationDto {
  @IsEnum(TargetType)
  targetType: TargetType;

  @ValidateIf((o) => o.targetType === TargetType.ROOM)
  @IsMongoId()
  roomId?: string;

  @ValidateIf((o) => o.targetType === TargetType.RESOURCE)
  @IsMongoId()
  resourceId?: string;

  @ValidateIf((o) => o.targetType === TargetType.COMBINATION)
  @IsMongoId()
  combinationId?: string;

  /** ISO 8601, ex.: 2026-11-03T13:00:00.000Z */
  @IsDateString() start: string;
  @IsDateString() end: string;

  @IsString() @MinLength(2) @MaxLength(120) title: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  /** Pessoas que poderão consultar esta marcação. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  viewerIds?: string[];
}

export class UpdateReservationDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsDateString() start?: string;
  @IsOptional() @IsDateString() end?: string;
}

export class AddViewersDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsMongoId({ each: true })
  userIds: string[];
}

export class QueryReservationsDto extends PaginationDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsEnum(ReservationStatus) status?: ReservationStatus;
  @IsOptional() @IsEnum(TargetType) targetType?: TargetType;
  @IsOptional() @IsMongoId() roomId?: string;
  @IsOptional() @IsMongoId() resourceId?: string;
  @IsOptional() @IsMongoId() combinationId?: string;
}

export class BusyQueryDto {
  @IsEnum(TargetType) targetType: TargetType;
  @IsMongoId() targetId: string;
  @IsDateString() from: string;
  @IsDateString() to: string;
}

export class CreateSeriesDto extends CreateReservationDto {
  /** Quantas reservas criar (a 1ª é a do próprio start/end). */
  @Type(() => Number) @IsInt() @Min(2) @Max(52) occurrences: number;
  /** De quantas em quantas semanas (padrão 1 = semanal). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(4) everyWeeks?: number;
  /** SKIP (padrão): pula ocorrências com conflito; FAIL: desfaz tudo se alguma falhar. */
  @IsOptional() @IsIn(['SKIP', 'FAIL']) onConflict?: 'SKIP' | 'FAIL';
}

export class CheckInDto {
  @IsString() @Length(6, 6) code: string;
}

export class DecisionDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
