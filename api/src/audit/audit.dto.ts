import { IsDateString, IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

export class AuditQueryDto extends PaginationDto {
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsMongoId() actorId?: string;
  @IsOptional() @IsIn(['POST', 'PATCH', 'PUT', 'DELETE']) method?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
