import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UpdateStatusDto } from '../common/availability.dto';
import { CurrentUser, RequestUser, Roles } from '../common/decorators';
import { AvailabilityStatus, Role } from '../common/enums';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { CreateRoomDto, UpdateRoomDto } from './rooms.dto';
import { RoomsService } from './rooms.service';

@ApiTags('rooms')
@ApiBearerAuth()
@Controller('rooms')
export class RoomsController {
  constructor(private readonly svc: RoomsService) {}

  @Get()
  list(@CurrentUser() me: RequestUser, @Query('status') status?: AvailabilityStatus) {
    return this.svc.list(me, status);
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() me: RequestUser) {
    return this.svc.getVisible(id, me);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  create(@Body() dto: CreateRoomDto, @CurrentUser() me: RequestUser) {
    return this.svc.create(dto, me);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateRoomDto, @CurrentUser() me: RequestUser) {
    return this.svc.update(id, dto, me);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.MANAGER)
  setStatus(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateStatusDto, @CurrentUser() me: RequestUser) {
    return this.svc.setStatus(id, dto, me);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() me: RequestUser) {
    return this.svc.remove(id, me);
  }
}
