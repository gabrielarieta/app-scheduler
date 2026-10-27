import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RequestUser } from '../common/decorators';
import { ApprovalStatus, ReservationStatus } from '../common/enums';
import { ReservationDocument, Reservation } from '../reservations/reservation.schema';
import { ReservationsService } from '../reservations/reservations.service';
import { IcsEvent } from './ics.util';

export function toEvent(r: ReservationDocument): IcsEvent {
  const room = r.snapshot.room;
  const res = r.snapshot.resource;
  const updated: Date = (r as any).updatedAt ?? r.start;
  const description = [
    res && `Recurso: ${res.name}${res.type ? ` (${res.type})` : ''}`,
    `Organizador: ${r.createdBySnapshot.name}`,
    r.notes,
    r.approvalStatus === ApprovalStatus.PENDING && 'Aguardando aprovação',
  ]
    .filter(Boolean)
    .join('\n');
  return {
    uid: `${r.id}@agenda`,
    start: r.start,
    end: r.end,
    summary: r.title,
    location: room ? `${room.name}${room.location ? ` — ${room.location}` : ''}` : res?.name,
    description,
    status:
      r.status === ReservationStatus.CANCELLED
        ? 'CANCELLED'
        : r.approvalStatus === ApprovalStatus.PENDING
          ? 'TENTATIVE'
          : 'CONFIRMED',
    sequence: Math.floor(+updated / 1000),
    stamp: updated,
  };
}

@Injectable()
export class CalendarService {
  constructor(
    @InjectModel(Reservation.name) private readonly model: Model<Reservation>,
    private readonly reservations: ReservationsService,
  ) {}

  /** Mesmas regras de visibilidade da API; inclui canceladas recentes (STATUS:CANCELLED) para os apps removerem. */
  async events(user: RequestUser, from: Date, to: Date): Promise<IcsEvent[]> {
    const docs = await this.model
      .find({
        ...this.reservations.visibility(user),
        start: { $gte: from, $lt: to },
        status: { $in: [ReservationStatus.ACTIVE, ReservationStatus.CANCELLED] },
      })
      .sort({ start: 1 })
      .limit(2000);
    return docs.map(toEvent);
  }
}
