import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { toJSONOptions } from '../common/json';

@Schema({ timestamps: { createdAt: true, updatedAt: false }, toJSON: toJSONOptions })
export class Notification {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId: Types.ObjectId;
  @Prop({ required: true }) type: string;
  @Prop({ required: true }) title: string;
  @Prop() body: string;
  @Prop({ type: Object }) data?: Record<string, unknown>;
  @Prop() readAt?: Date;
  createdAt?: Date;
}
export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 }); // some após 90 dias
