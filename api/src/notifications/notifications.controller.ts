import { Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequestUser } from '../common/decorators';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { ListNotificationsDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  async list(
    @Query() q: ListNotificationsDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { items, total } = await this.service.list(user.id, q);
    res.setHeader('X-Total-Count', String(total));
    return items;
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: RequestUser) {
    return { count: await this.service.unreadCount(user.id) };
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: RequestUser) {
    return this.service.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: RequestUser) {
    const n = await this.service.markRead(user.id, id);
    if (!n) throw new NotFoundException('Notificação não encontrada');
    return n;
  }
}
