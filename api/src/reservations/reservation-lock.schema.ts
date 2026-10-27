import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * Uma linha por bloco de tempo ocupado. O `_id` é a própria chave
 * (ex.: "room:<id>:<bloco>"), então o índice único do Mongo garante a exclusão mútua.
 */
@Schema({ collection: 'reservation_locks', versionKey: false })
export class ReservationLock {
  @Prop({ type: String })
  _id: string;

  @Prop({ type: Types.ObjectId, required: true })
  reservationId: Types.ObjectId;

  /** Presente apenas nas travas de confirmação de presença. */
  @Prop({ type: Types.ObjectId })
  userId?: Types.ObjectId;

  /** Identifica uma tentativa específica (permite desfazer só o que ela inseriu). */
  @Prop({ type: String, required: true, index: true })
  token: string;

  /**
   * TTL: enquanto a reserva está sendo gravada vale ~2 min (auto-limpeza se o
   * processo cair); depois passa a ser o fim da reserva (limpeza automática do passado).
   */
  @Prop({ type: Date })
  expireAt?: Date;
}

export const ReservationLockSchema = SchemaFactory.createForClass(ReservationLock);
ReservationLockSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
ReservationLockSchema.index({ reservationId: 1, userId: 1 });
