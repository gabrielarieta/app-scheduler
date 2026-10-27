import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Schema({ collection: 'idempotency_keys', versionKey: false })
export class IdempotencyKey {
  @Prop({ type: String }) _id: string;
  @Prop({ type: Date, default: Date.now }) createdAt: Date;
  @Prop({ type: Object }) result?: unknown;
}
export const IdempotencyKeySchema = SchemaFactory.createForClass(IdempotencyKey);
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 3600 });

const KEY_RE = /^[A-Za-z0-9_.:-]{8,100}$/;

/**
 * Header `Idempotency-Key`: a mesma chave (por usuário) devolve o resultado da 1ª chamada bem-sucedida
 * em vez de criar outra reserva. Falhas não ficam guardadas (a pessoa pode tentar de novo).
 */
@Injectable()
export class IdempotencyService {
  constructor(@InjectModel(IdempotencyKey.name) private readonly model: Model<IdempotencyKey>) {}

  async run<T>(userId: string, key: string | undefined, fn: () => Promise<T>): Promise<T | unknown> {
    if (!key) return fn();
    if (!KEY_RE.test(key)) throw new BadRequestException('Idempotency-Key inválida (8–100 caracteres: letras, números, _ . : -).');

    const _id = `${userId}:${key}`;
    try {
      await this.model.collection.insertOne({ _id, createdAt: new Date() } as any);
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      const prev = await this.model.findById(_id).lean();
      if (prev?.result !== undefined) return prev.result; // repetição: devolve o mesmo resultado
      throw new ConflictException('Requisição com esta Idempotency-Key ainda em andamento.');
    }

    try {
      const result = await fn();
      const plain = JSON.parse(JSON.stringify(result));
      await this.model.updateOne({ _id }, { $set: { result: plain } });
      return result;
    } catch (err) {
      await this.model.deleteOne({ _id });
      throw err;
    }
  }
}
