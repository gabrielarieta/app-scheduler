import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AvailabilityStatus } from '../common/enums';
import { toJSONOptions } from '../common/json';
import { AvailabilitySlot, AvailabilitySlotSchema } from '../common/slot.schema';

@Schema({ timestamps: true, toJSON: toJSONOptions })
export class Resource {
  @Prop({ required: true, trim: true, unique: true }) name: string;
  /** Tipo livre: "Projetor", "Notebook", "Câmera"... */
  @Prop({ required: true, trim: true }) type: string;
  @Prop({ trim: true }) description?: string;

  /** Unidade/campus. Itens sem unidade valem para todos (compatibilidade). */
  @Prop({ type: Types.ObjectId, ref: 'Unit', index: true }) unitId?: Types.ObjectId;
  /** Item sensível: reservas só valem depois da aprovação de um gestor. */
  @Prop({ default: false }) requiresApproval: boolean;
  /** Cancela a reserva se ninguém fizer check-in em N min após o início (0 = usa o padrão da unidade). */
  @Prop({ min: 0, default: 0 }) noShowGraceMinutes: number;

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
export type ResourceDocument = HydratedDocument<Resource>;
export const ResourceSchema = SchemaFactory.createForClass(Resource);
