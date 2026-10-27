import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationDto {
  /** Página (começa em 1). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  /** Itens por página (padrão 500, máx. 500). O total vem no header X-Total-Count. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

export function paginate(q: PaginationDto, defaultLimit = 500) {
  const limit = q.limit ?? defaultLimit;
  return { limit, skip: ((q.page ?? 1) - 1) * limit };
}
