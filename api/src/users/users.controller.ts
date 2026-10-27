import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser, Roles } from '../common/decorators';
import { Role } from '../common/enums';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import {
  CreateUserDto,
  ListUsersQueryDto,
  LookupQueryDto,
  PreferencesDto,
  UpdateUserDto,
} from './users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Quem marca (e o admin) procura pessoas para dar acesso de consulta. */
  @Get('lookup')
  @Roles(Role.ADMIN, Role.RESERVER)
  async lookup(@Query() q: LookupQueryDto) {
    const list = await this.users.lookup(q.q);
    return list.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
    }));
  }

  @Get()
  @Roles(Role.ADMIN)
  async list(@Query() q: ListUsersQueryDto, @Res({ passthrough: true }) res: Response) {
    const { items, total } = await this.users.list(q);
    res.setHeader('X-Total-Count', String(total));
    return items;
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateUserDto) {
    return this.users.createByAdmin(dto);
  }

  @Get('me/preferences')
  myPreferences(@CurrentUser() me: RequestUser) {
    return this.users.getPreferences(me.id);
  }

  @Patch('me/preferences')
  setMyPreferences(@Body() dto: PreferencesDto, @CurrentUser() me: RequestUser) {
    return this.users.setPreferences(me.id, dto);
  }

  /** Aprovar/recusar cadastro, trocar perfil, desativar, definir unidades. */
  @Patch(':id')
  @Roles(Role.ADMIN)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() me: RequestUser,
  ) {
    return this.users.update(id, dto, me.id);
  }
}
