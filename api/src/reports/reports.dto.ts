import { IsDateString, IsMongoId, IsOptional } from 'class-validator';

export class ReportQueryDto {
  /** Início do período (ISO). Máx. 92 dias. */
  @IsDateString() from: string;
  /** Fim (exclusivo). */
  @IsDateString() to: string;
  @IsOptional() @IsMongoId() unitId?: string;
}
