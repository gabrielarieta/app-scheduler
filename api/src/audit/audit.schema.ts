import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { toJSONOptions } from '../common/json';

@Schema({ collection: 'audit_logs', versionKey: false, toJSON: toJSONOptions })
export class AuditLog {
  @Prop({ type: Date, default: Date.now, index: true }) at: Date;
  @Prop({ type: Types.ObjectId, index: true }) actorId?: Types.ObjectId;
  @Prop() actorName?: string;
  @Prop() actorRole?: string;
  @Prop() method: string;
  @Prop() route: string;
  @Prop({ index: true }) entityId?: string;
  @Prop() statusCode: number;
  @Prop({ type: Object }) details?: Record<string, unknown>;
}
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ at: 1 }, { expireAfterSeconds: 365 * 24 * 3600 }); // guarda 1 ano
