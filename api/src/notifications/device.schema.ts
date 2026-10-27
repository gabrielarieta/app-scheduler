import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** Aparelho (token FCM) de uma pessoa. */
@Schema({ timestamps: true, versionKey: false })
export class Device {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId: Types.ObjectId;
  @Prop({ required: true, unique: true }) token: string;
  @Prop() platform?: string;
}
export const DeviceSchema = SchemaFactory.createForClass(Device);
