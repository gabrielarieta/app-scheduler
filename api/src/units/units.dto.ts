import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateUnitDto {
  @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{2,12}$/, { message: 'code: 2–12 letras/números' }) code: string;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(240) noShowGraceMinutes?: number;
}

export class UpdateUnitDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(240) noShowGraceMinutes?: number;
}
