import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, ROLES_KEY } from '../common/decorators';
import { Role } from '../common/enums';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (!roles?.length) return true; // qualquer usuário autenticado

    const { user } = ctx.switchToHttp().getRequest();
    // gestor (MANAGER) tem tudo que quem marca (RESERVER) tem
    const allowed =
      user && (roles.includes(user.role) || (user.role === Role.MANAGER && roles.includes(Role.RESERVER)));
    if (!allowed) {
      throw new ForbiddenException('Você não tem permissão para esta ação.');
    }
    return true;
  }
}
