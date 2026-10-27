import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { RequestUser } from './decorators';
import { Role } from './enums';

/** Admin global administra tudo; gestor só as suas unidades. */
export function canAdminUnit(user: RequestUser, unitId?: unknown): boolean {
  if (user.role === Role.ADMIN) return true;
  if (user.role !== Role.MANAGER) return false;
  return !!unitId && user.unitIds.includes(String(unitId));
}

/** O item é visível/utilizável por esta pessoa? Itens sem unidade valem para todos. */
export function inUnitScope(user: RequestUser, unitId?: unknown): boolean {
  if (user.role === Role.ADMIN || !unitId) return true;
  return user.unitIds.includes(String(unitId));
}

/** Filtro Mongo para listar só o que a pessoa enxerga (campo `unitId`). */
export function unitScopeFilter(user: RequestUser): Record<string, unknown> {
  if (user.role === Role.ADMIN) return {};
  return { $or: [{ unitId: null }, { unitId: { $in: user.unitIds.map((i) => new Types.ObjectId(i)) } }] };
}

/** Escrita no catálogo: admin em qualquer unidade; gestor só nas suas (e exige informar a unidade). */
export function assertUnitWrite(actor: RequestUser, unitId?: unknown): void {
  if (!canAdminUnit(actor, unitId)) {
    throw new ForbiddenException('Você só administra itens das suas unidades.');
  }
}
