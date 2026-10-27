import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { DEFAULT_SLOT_MINUTES } from '../common/slots.util';
import { ReservationLock } from './reservation-lock.schema';

/** Lançado quando algum bloco já pertence a outra reserva/confirmação. */
export class LockConflictError extends Error {
  constructor() {
    super('Bloco de tempo já ocupado');
    this.name = 'LockConflictError';
  }
}

function isDuplicateKey(err: any): boolean {
  return Boolean(
    err?.code === 11000 ||
      err?.writeErrors?.some?.((w: any) => w?.code === 11000 || w?.err?.code === 11000) ||
      /E11000/.test(String(err?.message ?? '')),
  );
}

const IN_FLIGHT_TTL_MS = 2 * 60_000;

@Injectable()
export class ReservationLocksService {
  private readonly logger = new Logger(ReservationLocksService.name);
  readonly slotMinutes: number;

  constructor(
    @InjectModel(ReservationLock.name) private readonly model: Model<ReservationLock>,
    config: ConfigService,
  ) {
    const n = Number(config.get('SLOT_MINUTES') ?? DEFAULT_SLOT_MINUTES);
    if (!Number.isInteger(n) || n < 1 || 1440 % n !== 0) {
      throw new Error('SLOT_MINUTES deve ser um inteiro que divide 1440 (ex.: 5, 10, 15, 30, 60)');
    }
    this.slotMinutes = n;
  }

  /**
   * Tenta ocupar todos os blocos. Inserção ORDENADA e em ordem global: quem pegar
   * o primeiro bloco disputado vence, o outro para ali (sem "dois perdem").
   * Em colisão desfaz o que inseriu e lança LockConflictError.
   * @returns token da tentativa (use em confirm/releaseByToken)
   */
  async acquire(
    keys: string[],
    owner: { reservationId: Types.ObjectId; userId?: Types.ObjectId },
    opts: { session?: ClientSession; expireAt?: Date } = {},
  ): Promise<string> {
    const token = new Types.ObjectId().toHexString();
    if (!keys.length) return token;

    const expireAt = opts.expireAt ?? new Date(Date.now() + IN_FLIGHT_TTL_MS);
    const docs = [...keys].sort().map((k) => ({
      _id: k,
      reservationId: owner.reservationId,
      ...(owner.userId ? { userId: owner.userId } : {}),
      token,
      expireAt,
    }));

    try {
      await this.model.collection.insertMany(docs as any, { ordered: true, session: opts.session });
    } catch (err) {
      await this.releaseByToken(token);
      if (isDuplicateKey(err)) throw new LockConflictError();
      throw err;
    }
    return token;
  }

  /** As chaves já pertencem a esta reserva (e pessoa)? Usado para tornar a confirmação idempotente. */
  async ownedBy(
    keys: string[],
    reservationId: Types.ObjectId,
    userId?: Types.ObjectId,
  ): Promise<boolean> {
    const filter: any = { _id: { $in: keys }, reservationId };
    if (userId) filter.userId = userId;
    return (await this.model.countDocuments(filter)) === keys.length;
  }

  /** Torna as travas da tentativa definitivas (expiram só quando a reserva terminar). */
  confirm(token: string, expireAt: Date): Promise<void> {
    return this.retry(() => this.model.updateMany({ token }, { $set: { expireAt } }));
  }

  /** Ajusta o vencimento de todas as travas da reserva (após remarcar). */
  extendReservation(reservationId: Types.ObjectId, expireAt: Date): Promise<void> {
    return this.retry(() => this.model.updateMany({ reservationId }, { $set: { expireAt } }));
  }

  async releaseByToken(token: string): Promise<void> {
    await this.model.deleteMany({ token });
  }

  async releaseReservation(reservationId: Types.ObjectId): Promise<void> {
    await this.model.deleteMany({ reservationId });
  }

  async releaseKeys(keys: string[], reservationId: Types.ObjectId): Promise<void> {
    if (!keys.length) return;
    await this.model.deleteMany({ _id: { $in: keys }, reservationId } as any);
  }

  /** Libera as travas de presença de uma pessoa (ou de todas, se userId omitido). */
  async releaseAttendance(reservationId: Types.ObjectId, userId?: Types.ObjectId): Promise<void> {
    const filter: any = { reservationId, userId: userId ?? { $exists: true } };
    await this.model.deleteMany(filter);
  }

  private async retry(fn: () => Promise<unknown>): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await fn();
        return;
      } catch (err) {
        if (attempt === 3) this.logger.error('Falha ao atualizar vencimento das travas', err as Error);
      }
    }
  }
}
