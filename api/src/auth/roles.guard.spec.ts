import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public, Roles } from '../common/decorators';
import { Role } from '../common/enums';
import { RolesGuard } from './roles.guard';

class Dummy {
  @Roles(Role.ADMIN)
  adminOnly() {}
  @Roles(Role.ADMIN, Role.RESERVER)
  adminOrReserver() {}
  anyone() {}
  @Public()
  open() {}
}

function ctx(method: keyof Dummy, role?: Role): ExecutionContext {
  return {
    getHandler: () => Dummy.prototype[method],
    getClass: () => Dummy,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('sem @Roles, qualquer autenticado passa', () => {
    expect(guard.canActivate(ctx('anyone', Role.VIEWER))).toBe(true);
  });
  it('rota @Public passa', () => {
    expect(guard.canActivate(ctx('open'))).toBe(true);
  });
  it('admin acessa rota de admin', () => {
    expect(guard.canActivate(ctx('adminOnly', Role.ADMIN))).toBe(true);
  });
  it('quem marca e quem consulta não acessam rota de admin', () => {
    expect(() => guard.canActivate(ctx('adminOnly', Role.RESERVER))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('adminOnly', Role.VIEWER))).toThrow(ForbiddenException);
  });
  it('quem consulta não acessa rota de admin/quem marca', () => {
    expect(guard.canActivate(ctx('adminOrReserver', Role.RESERVER))).toBe(true);
    expect(() => guard.canActivate(ctx('adminOrReserver', Role.VIEWER))).toThrow(ForbiddenException);
  });
  it('sem usuário na requisição é negado', () => {
    expect(() => guard.canActivate(ctx('adminOnly'))).toThrow(ForbiddenException);
  });
});
