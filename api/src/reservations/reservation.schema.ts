import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ApprovalStatus, CancelReason, ReservationStatus, TargetType } from '../common/enums';
import { toJSONOptions } from '../common/json';

@Schema({ _id: false })
export class Viewer {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;
  @Prop() name: string;
  @Prop() email: string;
  /** Presença confirmada pela própria pessoa (só ela pode confirmar). */
  @Prop() confirmedAt?: Date;
  /** Presença real registrada via código/QR no local. */
  @Prop() checkedInAt?: Date;
}
const ViewerSchema = SchemaFactory.createForClass(Viewer);

/**
 * Cópia congelada dos dados no momento da reserva. Se a sala/recurso for
 * editado ou removido depois, o histórico continua exatamente como foi marcado.
 */
export interface SnapshotEntity {
  id: string;
  name?: string;
  type?: string;
  location?: string;
  capacity?: number;
  description?: string;
  notes?: string;
  availability: { weekday: number; start: string; end: string }[];
}
export interface ReservationSnapshot {
  room?: SnapshotEntity;
  resource?: SnapshotEntity;
  combination?: SnapshotEntity;
}

@Schema({ timestamps: true, toJSON: toJSONOptions })
export class Reservation {
  @Prop({ type: String, enum: Object.values(TargetType), required: true })
  targetType: TargetType;

  // Referências usadas para detectar conflito (sala e/ou recurso ocupados).
  @Prop({ type: Types.ObjectId, index: true }) roomId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, index: true }) resourceId?: Types.ObjectId;
  @Prop({ type: Types.ObjectId, index: true }) combinationId?: Types.ObjectId;
  /** Reservas criadas juntas (recorrência). */
  @Prop({ type: Types.ObjectId, index: true }) seriesId?: Types.ObjectId;

  /** Unidade/campus (copiada do item reservado). */
  @Prop({ type: Types.ObjectId, index: true }) unitId?: Types.ObjectId;

  /** Itens sensíveis: PENDING segura o horário até um gestor decidir. */
  @Prop({ type: String, enum: Object.values(ApprovalStatus), default: ApprovalStatus.NOT_REQUIRED, index: true })
  approvalStatus: ApprovalStatus;
  @Prop({ type: Types.ObjectId }) decidedBy?: Types.ObjectId;
  @Prop() decidedByName?: string;
  @Prop() decidedAt?: Date;
  @Prop() decisionNote?: string;

  /** Tolerância de no-show gravada na hora da reserva (0 = não cancela sozinho). */
  @Prop({ default: 0 }) noShowGraceMinutes: number;
  /** O organizador iniciou a reserva (presença do organizador). */
  @Prop() startedAt?: Date;
  @Prop({ type: String, enum: Object.values(CancelReason) }) cancelReason?: CancelReason;

  @Prop({ required: true }) start: Date;
  @Prop({ required: true }) end: Date;

  @Prop({ required: true, trim: true }) title: string;
  @Prop({ trim: true }) notes?: string;

  @Prop({
    type: String,
    enum: Object.values(ReservationStatus),
    default: ReservationStatus.ACTIVE,
  })
  status: ReservationStatus;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Object, required: true })
  createdBySnapshot: { name: string; email: string };

  /** Pessoas que podem consultar esta marcação (adicionadas por quem marcou). */
  @Prop({ type: [ViewerSchema], default: [] })
  viewers: Viewer[];

  @Prop({ type: Object, required: true })
  snapshot: ReservationSnapshot;

  @Prop() cancelledAt?: Date;
  @Prop({ type: Types.ObjectId }) cancelledBy?: Types.ObjectId;
}

export type ReservationDocument = HydratedDocument<Reservation>;
export const ReservationSchema = SchemaFactory.createForClass(Reservation);
ReservationSchema.index({ status: 1, start: 1, end: 1 });
ReservationSchema.index({ 'viewers.userId': 1 });
