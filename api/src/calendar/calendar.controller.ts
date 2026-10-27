import { Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser, Public, RequestUser } from '../common/decorators';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { ReservationsService } from '../reservations/reservations.service';
import { UsersService } from '../users/users.service';
import { CalendarService, toEvent } from './calendar.service';
import { buildCalendar } from './ics.util';

const DAY = 86_400_000;

@ApiTags('calendar')
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly users: UsersService,
    private readonly calendar: CalendarService,
    private readonly reservations: ReservationsService,
    private readonly config: ConfigService,
  ) {}

  private base(req: Request): string {
    const fixed = this.config.get<string>('PUBLIC_BASE_URL');
    if (fixed) return fixed.replace(/\/$/, '');
    const proto = (req.headers['x-forwarded-proto'] as string) ?? req.protocol;
    return `${proto}://${req.get('host')}`;
  }

  private ics(res: Response, body: string, filename?: string) {
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    if (filename) res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return body;
  }

  /** URL para "assinar" no Google Calendar / Apple / Outlook (cada pessoa tem a sua, secreta). */
  @ApiBearerAuth()
  @Get('feed-url')
  async feedUrl(@CurrentUser() me: RequestUser, @Req() req: Request) {
    const token = await this.users.calendarToken(me.id);
    return { url: `${this.base(req)}/api/calendar/feed/${token}.ics` };
  }

  /** Gera nova URL; a anterior deixa de funcionar. */
  @ApiBearerAuth()
  @Post('feed-url/rotate')
  @HttpCode(200)
  async rotate(@CurrentUser() me: RequestUser, @Req() req: Request) {
    const token = await this.users.calendarToken(me.id, true);
    return { url: `${this.base(req)}/api/calendar/feed/${token}.ics` };
  }

  /** Feed público (o segredo está na URL — apps de calendário não enviam Bearer). */
  @Public()
  @Get('feed/:token')
  async feed(@Param('token') raw: string, @Res({ passthrough: true }) res: Response) {
    const user = await this.users.findByCalendarToken(raw.replace(/\.ics$/, ''));
    if (!user) throw new NotFoundException();
    const me: RequestUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      unitIds: (user.unitIds ?? []).map(String),
    };
    const now = Date.now();
    const events = await this.calendar.events(me, new Date(now - 30 * DAY), new Date(now + 180 * DAY));
    res.setHeader('Cache-Control', 'private, max-age=300');
    return this.ics(res, buildCalendar(events, `Agenda — ${user.name}`));
  }

  /** Baixa um .ics com as suas reservas (padrão: 30 dias atrás até 180 à frente). */
  @ApiBearerAuth()
  @Get('export.ics')
  async export(
    @CurrentUser() me: RequestUser,
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const now = Date.now();
    const f = from ? new Date(from) : new Date(now - 30 * DAY);
    const t = to ? new Date(to) : new Date(now + 180 * DAY);
    const events = await this.calendar.events(me, f, t);
    return this.ics(res, buildCalendar(events, `Agenda — ${me.name}`), 'agenda.ics');
  }

  /** Uma reserva só (botão "Adicionar ao calendário"). */
  @ApiBearerAuth()
  @Get('reservation/:id')
  async one(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() me: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const doc = await this.reservations.findVisible(id, me);
    return this.ics(res, buildCalendar([toEvent(doc)], doc.title), 'reserva.ics');
  }
}
