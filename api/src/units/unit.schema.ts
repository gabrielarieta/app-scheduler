import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { toJSONOptions } from '../common/json';

/** Unidade / campus: separa salas, recursos, gestores e relatórios. */
@Schema({ timestamps: true, toJSON: toJSONOptions })
export class Unit {
  @Prop({ required: true, trim: true, unique: true }) name: string;
  @Prop({ required: true, trim: true, uppercase: true, unique: true }) code: string;
  /** Fuso da unidade (ex.: America/Manaus). Vazio = APP_TIMEZONE. */
  @Prop({ trim: true }) timezone?: string;
  /** Tolerância padrão de no-show (min) para itens da unidade; 0 = sem cancelamento automático. */
  @Prop({ min: 0, default: 0 }) noShowGraceMinutes: number;
}
export type UnitDocument = HydratedDocument<Unit>;
export const UnitSchema = SchemaFactory.createForClass(Unit);
