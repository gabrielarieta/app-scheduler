import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Notification, NotificationSchema } from './notification.schema';
import { User, UserSchema } from '../users/user.schema';
import { ChannelsService } from './channels.service';
import { Device, DeviceSchema } from './device.schema';
import { DevicesController } from './devices.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: User.name, schema: UserSchema },
      { name: Device.name, schema: DeviceSchema },
    ]),
  ],
  controllers: [NotificationsController, DevicesController],
  providers: [NotificationsService, ChannelsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
