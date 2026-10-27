import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AvailabilityStatus } from '../common/enums';
import { toJSONOptions } from '../common/json';
import { AvailabilitySlot, AvailabilitySlotSchema } from '../common/slot.schema';

/** Par sala + recurso com horários próprios (ex.: Sala 3 + Projetor, só de manhã). */
@Schema({ timestamps: true, toJSON: toJSONOptions })
export class Combination {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  room: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Resource', required: true })
  resource: Types.ObjectId;

  @Prop({ trim: true }) notes?: string;

  /** Herdada da sala. */
  @Prop({ type: Types.ObjectId, ref: 'Unit', index: true }) unitId?: Types.ObjectId;
  @Prop({ default: false }) requiresApproval: boolean;

  @Prop({
    type: String,
    enum: Object.values(AvailabilityStatus),
    default: AvailabilityStatus.AVAILABLE,
  })
  status: AvailabilityStatus;
  @Prop({ trim: true }) statusNote?: string;

  @Prop({ type: [AvailabilitySlotSchema], default: [] })
  availability: AvailabilitySlot[];
}
export type CombinationDocument = HydratedDocument<Combination>;
export const CombinationSchema = SchemaFactory.createForClass(Combination);
CombinationSchema.index({ room: 1, resource: 1 }, { unique: true });
