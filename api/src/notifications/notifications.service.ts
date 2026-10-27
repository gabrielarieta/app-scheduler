import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User } from '../users/user.schema';
import { ChannelsService } from './channels.service';
import { Device } from './device.schema';
import { paginate } from '../common/pagination.dto';
import { ListNotificationsDto } from './notifications.dto';
import { Notification } from './notification.schema';

export interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Notificações dentro do app. Ponto de extensão: para push (FCM) ou e-mail,
 * acrescente o envio dentro de notify() — todos os eventos já passam por aqui.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  constructor(
    @InjectModel(Notification.name) private readonly model: Model<Notification>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Device.name) private readonly devices: Model<Device>,
    private readonly channels: ChannelsService,
  ) {}

  /** Nunca lança: falha de notificação não pode derrubar a operação principal. */
  async notify(userIds: (string | Types.ObjectId)[], p: NotificationPayload): Promise<void> {
    const unique = [...new Set(userIds.map(String))];
    if (!unique.length) return;
    try {
      await this.model.insertMany(unique.map((u) => ({ userId: new Types.ObjectId(u), ...p })));
      void this.dispatch(unique, p); // e-mail/push em segundo plano
    } catch (err) {
      this.logger.error('Falha ao gravar notificações', err as Error);
    }
  }

  async list(userId: string, q: ListNotificationsDto) {
    const filter: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
    if (q.unread) filter.readAt = { $exists: false };
    const { limit, skip } = paginate(q, 50);
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      this.model.countDocuments(filter),
    ]);
    return { items, total };
  }

  unreadCount(userId: string) {
    return this.model.countDocuments({ userId: new Types.ObjectId(userId), readAt: { $exists: false } });
  }

  markRead(userId: string, id: string) {
    return this.model.findOneAndUpdate(
      { _id: id, userId: new Types.ObjectId(userId) },
      { $set: { readAt: new Date() } },
      { new: true },
    );
  }

  async markAllRead(userId: string) {
    const r = await this.model.updateMany(
      { userId: new Types.ObjectId(userId), readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
    return { updated: r.modifiedCount };
  }

  /** E-mail e push, respeitando as preferências de cada pessoa. Nunca lança. */
  private async dispatch(userIds: string[], p: NotificationPayload): Promise<void> {
    try {
      if (!this.channels.emailEnabled && !this.channels.pushEnabled) return;
      const ids = userIds.map((i) => new Types.ObjectId(i));
      const users = await this.users.find({ _id: { $in: ids } }).select('email prefs').lean();

      if (this.channels.emailEnabled) {
        await Promise.allSettled(
          users.filter((u) => u.prefs?.email !== false).map((u) => this.channels.sendEmail(u.email, p.title, p.body)),
        );
      }
      if (this.channels.pushEnabled) {
        const pushIds = users.filter((u) => u.prefs?.push !== false).map((u) => u._id);
        const devices = await this.devices.find({ userId: { $in: pushIds } }).lean();
        const bad = await this.channels.sendPush(devices.map((d) => d.token), p.title, p.body, p.data);
        if (bad.length) await this.devices.deleteMany({ token: { $in: bad } });
      }
    } catch (err) {
      this.logger.warn(`Falha ao despachar canais externos: ${(err as Error).message}`);
    }
  }
}
