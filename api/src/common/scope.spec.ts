import { ForbiddenException } from '@nestjs/common';
import { RequestUser } from './decorators';
import { Role } from './enums';
import { assertUnitWrite, canAdminUnit, inUnitScope, unitScopeFilter } from './scope';

const U = (role: Role, unitIds: string[] = []): RequestUser => ({ id: 'x', name: 'n', email: 'e', role, unitIds });
const A = '64b000000000000000000001';
const B = '64b000000000000000000002';

describe('scope', () => {
  it('admin administra tudo; gestor só as suas unidades; demais nunca', () => {
    expect(canAdminUnit(U(Role.ADMIN), B)).toBe(true);
    expect(canAdminUnit(U(Role.MANAGER, [A]), A)).toBe(true);
    expect(canAdminUnit(U(Role.MANAGER, [A]), B)).toBe(false);
    expect(canAdminUnit(U(Role.MANAGER, [A]), undefined)).toBe(false);
    expect(canAdminUnit(U(Role.RESERVER, [A]), A)).toBe(false);
  });

  it('itens sem unidade valem para todos; com unidade, só para quem pertence', () => {
    expect(inUnitScope(U(Role.RESERVER, [A]), undefined)).toBe(true);
    expect(inUnitScope(U(Role.RESERVER, [A]), A)).toBe(true);
    expect(inUnitScope(U(Role.RESERVER, [A]), B)).toBe(false);
    expect(inUnitScope(U(Role.ADMIN), B)).toBe(true);
  });

  it('unitScopeFilter: vazio para admin, $or para os demais', () => {
    expect(unitScopeFilter(U(Role.ADMIN))).toEqual({});
    expect(unitScopeFilter(U(Role.VIEWER, [A]))).toHaveProperty('$or');
  });

  it('assertUnitWrite bloqueia gestor fora da unidade', () => {
    expect(() => assertUnitWrite(U(Role.MANAGER, [A]), A)).not.toThrow();
    expect(() => assertUnitWrite(U(Role.MANAGER, [A]), B)).toThrow(ForbiddenException);
    expect(() => assertUnitWrite(U(Role.MANAGER, [A]), undefined)).toThrow(ForbiddenException);
  });
});
