import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser, Roles } from '../common/decorators';
import { Role } from '../common/enums';
import { ParseObjectIdPipe } from '../common/parse-object-id.pipe';
import { JoinWaitlistDto } from './waitlist.dto';
import { WaitlistService } from './waitlist.service';

@ApiTags('waitlist')
@ApiBearerAuth()
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly service: WaitlistService) {}

  @Post()
  @Roles(Role.ADMIN, Role.RESERVER)
  join(@Body() dto: JoinWaitlistDto, @CurrentUser() user: RequestUser) {
    return this.service.join(dto, user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.RESERVER)
  list(@CurrentUser() user: RequestUser) {
    return this.service.list(user);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.service.remove(id, user);
  }
}
