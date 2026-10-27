import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { TargetType } from '../common/enums';
import { toJSONOptions } from '../common/json';

@Schema({ timestamps: true, toJSON: toJSONOptions })
export class WaitlistEntry {
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId: Types.ObjectId;
  @Prop({ type: String, enum: Object.values(TargetType), required: true }) targetType: TargetType;
  @Prop({ type: Types.ObjectId, index: true }) roomId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, index: true }) resourceId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId }) combinationId?: Types.ObjectId;
  @Prop() label?: string;
  @Prop({ required: true }) start: Date;
  @Prop({ required: true }) end: Date;
  @Prop({ type: String, enum: ['WAITING', 'NOTIFIED'], default: 'WAITING', index: true })
  status: 'WAITING' | 'NOTIFIED';
  @Prop() notifiedAt?: Date;
  /** = fim do horário desejado; o Mongo remove sozinho depois. */
  @Prop({ type: Date, required: true }) expireAt: Date;
}
export const WaitlistEntrySchema = SchemaFactory.createForClass(WaitlistEntry);
WaitlistEntrySchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
