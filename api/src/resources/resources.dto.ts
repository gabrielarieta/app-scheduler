import { IsBoolean, IsInt, IsMongoId, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AvailabilitySlotDto } from '../common/availability.dto';

export class CreateResourceDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsString() @MinLength(2) @MaxLength(60) type: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsMongoId() unitId?: string;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(240) noShowGraceMinutes?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'Informe ao menos um horário de disponibilidade' })
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability: AvailabilitySlotDto[];
}

export class UpdateResourceDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) type?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsMongoId() unitId?: string;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(240) noShowGraceMinutes?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability?: AvailabilitySlotDto[];
}
