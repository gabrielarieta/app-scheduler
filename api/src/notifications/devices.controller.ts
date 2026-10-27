import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Model, Types } from 'mongoose';
import { CurrentUser, RequestUser } from '../common/decorators';
import { Device } from './device.schema';

export class RegisterDeviceDto {
  @IsString() @MaxLength(4096) token: string;
  @IsOptional() @IsString() @MaxLength(30) platform?: string;
}

@ApiTags('devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(@InjectModel(Device.name) private readonly model: Model<Device>) {}

  /** O app registra o token FCM (o mesmo aparelho passa a pertencer a quem logou por último). */
  @Post()
  @HttpCode(200)
  async register(@Body() dto: RegisterDeviceDto, @CurrentUser() me: RequestUser) {
    await this.model.updateOne(
      { token: dto.token },
      { $set: { userId: new Types.ObjectId(me.id), platform: dto.platform } },
      { upsert: true },
    );
    return { ok: true };
  }

  @Post('unregister')
  @HttpCode(200)
  async unregister(@Body() dto: RegisterDeviceDto, @CurrentUser() me: RequestUser) {
    await this.model.deleteOne({ token: dto.token, userId: new Types.ObjectId(me.id) });
    return { ok: true };
  }
}
