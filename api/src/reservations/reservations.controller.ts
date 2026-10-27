import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequestUser, Roles } from '../common/decorators';
import { Role } from '../common/enums';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { IdempotencyService } from './idempotency.service';
import { ReservationsExtrasService } from './reservations-extras.service';
import {
  AddViewersDto, BusyQueryDto, CheckInDto, CreateReservationDto, CreateSeriesDto, DecisionDto,
  QueryReservationsDto, UpdateReservationDto,
} from './reservations.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('reservations')
@ApiBearerAuth()
@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly service: ReservationsService,
    private readonly extras: ReservationsExtrasService,
    private readonly idem: IdempotencyService,
  ) {}

  /** Admin vê tudo; quem marca vê as suas; quem consulta vê onde foi adicionado. Total em X-Total-Count. */
  @Get()
  async list(
    @Query() q: QueryReservationsDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.service.list(q, user);
    res.setHeader('X-Total-Count', String(total));
    return items;
  }

  @Get('busy')
  @Roles(Role.ADMIN, Role.RESERVER)
  busy(@Query() q: BusyQueryDto) {
    return this.service.busy(q);
  }

  /** Reservas de itens sensíveis aguardando decisão (gestor da unidade / admin). */
  @Get('pending-approval')
  @Roles(Role.ADMIN, Role.MANAGER)
  pendingApproval(@CurrentUser() user: RequestUser) {
    return this.extras.pending(user);
  }

  /** Recorrência: cria N reservas semanais. Aceita o header Idempotency-Key. */
  @Post('series')
  @Roles(Role.ADMIN, Role.RESERVER)
  createSeries(
    @Body() dto: CreateSeriesDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.idem.run(user.id, key, () => this.extras.createSeries(dto, user));
  }

  @Post('series/:seriesId/cancel')
  @Roles(Role.ADMIN, Role.RESERVER)
  cancelSeries(@Param('seriesId', ParseObjectIdPipe) seriesId: string, @CurrentUser() user: RequestUser) {
    return this.extras.cancelSeries(seriesId, user);
  }

  @Get(':id')
  get(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.service.findVisible(id, user);
  }

  /** Header opcional `Idempotency-Key`: retentativas com a mesma chave não duplicam a reserva. */
  @Post()
  @Roles(Role.ADMIN, Role.RESERVER)
  create(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user: RequestUser,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.idem.run(user.id, key, () => this.service.create(dto, user));
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.RESERVER)
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateReservationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/cancel')
  @Roles(Role.ADMIN, Role.RESERVER)
  cancel(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.service.cancel(id, user);
  }

  @Post(':id/viewers')
  @Roles(Role.ADMIN, Role.RESERVER)
  addViewers(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddViewersDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.addViewers(id, dto, user);
  }

  /** Quem consulta confirma a própria presença (bloqueia horários concorrentes). */
  @Post(':id/attendance')
  @HttpCode(200)
  confirmAttendance(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.service.confirmAttendance(id, user);
  }

  @Delete(':id/attendance')
  cancelAttendance(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.service.cancelAttendance(id, user);
  }

  /** Código (e conteúdo do QR) que o organizador exibe no local. */
  @Get(':id/check-in-code')
  @Roles(Role.ADMIN, Role.RESERVER)
  checkInCode(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.extras.checkInCode(id, user);
  }

  /** Check-in de presença real (de 15 min antes do início até o fim). */
  @Post(':id/check-in')
  @HttpCode(200)
  checkIn(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CheckInDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.extras.checkIn(id, dto.code, user);
  }

  @Post(':id/approve')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(200)
  approve(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() user: RequestUser) {
    return this.extras.approve(id, user, dto.note);
  }

  @Post(':id/reject')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(200)
  reject(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() user: RequestUser) {
    return this.extras.reject(id, user, dto.note);
  }

  /** O organizador inicia a reserva (conta como presença dele). */
  @Post(':id/start')
  @Roles(Role.ADMIN, Role.RESERVER)
  @HttpCode(200)
  start(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.extras.start(id, user);
  }

  @Delete(':id/viewers/:userId')
  @Roles(Role.ADMIN, Role.RESERVER)
  removeViewer(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.service.removeViewer(id, userId, user);
  }
}
