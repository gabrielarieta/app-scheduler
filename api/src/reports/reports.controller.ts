import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequestUser, Roles } from '../common/decorators';
import { Role } from '../common/enums';
import { ReportQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Taxa de uso por sala/recurso, no-show, presença e horários de pico. */
  @Get('occupancy')
  @Roles(Role.ADMIN, Role.MANAGER)
  occupancy(@Query() q: ReportQueryDto, @CurrentUser() user: RequestUser) {
    return this.reports.occupancy(q, user);
  }

  @Get('occupancy.csv')
  @Roles(Role.ADMIN, Role.MANAGER)
  async occupancyCsv(
    @Query() q: ReportQueryDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reports.occupancy(q, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ocupacao.csv"');
    return this.reports.toCsv(data);
  }
}
