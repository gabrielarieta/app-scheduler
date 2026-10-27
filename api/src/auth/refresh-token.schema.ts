import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** Guarda só o hash (sha256) do refresh token; o valor real existe apenas no app. */
@Schema({ collection: 'refresh_tokens', versionKey: false })
export class RefreshToken {
  @Prop({ type: String }) _id: string;
  @Prop({ type: Types.ObjectId, required: true, index: true }) userId: Types.ObjectId;
  @Prop({ type: Date, required: true }) expiresAt: Date;
}
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
