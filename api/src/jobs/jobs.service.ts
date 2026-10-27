import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RequestUser } from '../common/decorators';
import { ApprovalStatus, CancelReason, ReservationStatus, Role } from '../common/enums';
import { Reservation } from '../reservations/reservation.schema';
import { ReservationsService } from '../reservations/reservations.service';
import { JobLease } from './job-lease.schema';

const SYSTEM: RequestUser = {
  id: '000000000000000000000000',
  name: 'Sistema',
  email: 'sistema@agenda.local',
  role: Role.ADMIN,
  unitIds: [],
};

/**
 * Rotinas por minuto: (1) cancela reservas sem check-in após a tolerância (no-show) e
 * (2) expira pendências de aprovação cujo horário já começou. Desligue com JOBS_ENABLED=false.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectModel(Reservation.name) private readonly model: Model<Reservation>,
    @InjectModel(JobLease.name) private readonly leases: Model<JobLease>,
    private readonly reservations: ReservationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get('JOBS_ENABLED') === 'false') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Só uma instância executa por vez (lease no Mongo). */
  private async lease(name: string, ttlMs: number): Promise<boolean> {
    try {
      await this.leases.findOneAndUpdate(
        { _id: name, until: { $lt: new Date() } } as any,
        { $set: { until: new Date(Date.now() + ttlMs) } },
        { upsert: true },
      );
      return true;
    } catch (err: any) {
      if (err?.code === 11000) return false; // outra instância está com o lease
      throw err;
    }
  }

  async tick() {
    try {
      if (!(await this.lease('reservation-jobs', 50_000))) return;
      await this.cancelNoShows();
      await this.expirePending();
    } catch (err) {
      this.logger.error('Falha na rotina agendada', err as Error);
    }
  }

  /** Reserva em andamento, com tolerância vencida e sem nenhum check-in/início → libera a sala. */
  async cancelNoShows(): Promise<number> {
    const now = new Date();
    const list = await this.model
      .find({
        status: ReservationStatus.ACTIVE,
        approvalStatus: { $nin: [ApprovalStatus.PENDING, ApprovalStatus.REJECTED, ApprovalStatus.EXPIRED] },
        noShowGraceMinutes: { $gt: 0 },
        end: { $gt: now },
        startedAt: { $exists: false },
        'viewers.checkedInAt': { $exists: false },
        $expr: { $lte: [{ $add: ['$start', { $multiply: ['$noShowGraceMinutes', 60_000] }] }, now] },
      } as any)
      .limit(200);

    let n = 0;
    for (const r of list) {
      try {
        await this.reservations.cancel(r.id, SYSTEM, {
          reason: CancelReason.NO_SHOW,
          note: `Ninguém fez check-in em ${r.noShowGraceMinutes} min.`,
        });
        n++;
      } catch (err) {
        this.logger.warn(`Não foi possível cancelar no-show ${r.id}: ${(err as Error).message}`);
      }
    }
    return n;
  }

  /** Pendência que ninguém decidiu até o início do horário. */
  async expirePending(): Promise<number> {
    const list = await this.model
      .find({ approvalStatus: ApprovalStatus.PENDING, status: ReservationStatus.ACTIVE, start: { $lte: new Date() } })
      .limit(200);
    let n = 0;
    for (const r of list) {
      try {
        await this.reservations.cancel(r.id, SYSTEM, { reason: CancelReason.EXPIRED, note: 'Não foi aprovada a tempo.' });
        await this.model.updateOne({ _id: r._id }, { $set: { approvalStatus: ApprovalStatus.EXPIRED } });
        n++;
      } catch (err) {
        this.logger.warn(`Não foi possível expirar ${r.id}: ${(err as Error).message}`);
      }
    }
    return n;
  }
}
