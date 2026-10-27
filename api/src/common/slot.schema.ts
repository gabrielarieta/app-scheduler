import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Janela de disponibilidade semanal. weekday: 0 = domingo ... 6 = sábado. */
@Schema({ _id: false })
export class AvailabilitySlot {
  @Prop({ required: true, min: 0, max: 6 })
  weekday: number;

  /** "HH:mm" */
  @Prop({ required: true })
  start: string;

  /** "HH:mm" (aceita "24:00" para ir até o fim do dia) */
  @Prop({ required: true })
  end: string;
}

export const AvailabilitySlotSchema =
  SchemaFactory.createForClass(AvailabilitySlot);
