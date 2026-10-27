import { IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AvailabilitySlotDto } from '../common/availability.dto';

export class CreateCombinationDto {
  @IsMongoId() roomId: string;
  @IsMongoId() resourceId: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'Informe ao menos um horário de disponibilidade' })
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability: AvailabilitySlotDto[];
}

export class UpdateCombinationDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability?: AvailabilitySlotDto[];
}
