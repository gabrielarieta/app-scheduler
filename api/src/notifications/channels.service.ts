import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import * as nodemailer from 'nodemailer';

/**
 * Canais externos das notificações. Ficam desligados se não configurados:
 *  - e-mail: SMTP_HOST (+ SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE)
 *  - push:   FCM_SERVICE_ACCOUNT_JSON (conteúdo) ou FCM_SERVICE_ACCOUNT_FILE (caminho)
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);
  private readonly mailer?: nodemailer.Transporter;
  private readonly from?: string;
  private messaging?: Promise<any>;

  constructor(private readonly config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    if (host) {
      const port = Number(config.get('SMTP_PORT') ?? 587);
      const user = config.get<string>('SMTP_USER');
      this.mailer = nodemailer.createTransport({
        host,
        port,
        secure: config.get('SMTP_SECURE') === 'true' || port === 465,
        auth: user ? { user, pass: config.get<string>('SMTP_PASS') } : undefined,
      });
      this.from = config.get<string>('SMTP_FROM') ?? user;
    }
  }

  get emailEnabled(): boolean {
    return !!this.mailer;
  }

  get pushEnabled(): boolean {
    return !!(this.config.get('FCM_SERVICE_ACCOUNT_JSON') || this.config.get('FCM_SERVICE_ACCOUNT_FILE'));
  }

  async sendEmail(to: string, subject: string, text: string): Promise<void> {
    if (!this.mailer) return;
    try {
      await this.mailer.sendMail({
        from: this.from,
        to,
        subject: `[Agenda] ${subject}`,
        text: `${text}\n\n— Agenda de Salas e Recursos\n(Você pode desligar os e-mails em Configurações, no app.)`,
      });
    } catch (err) {
      this.logger.warn(`Falha ao enviar e-mail para ${to}: ${(err as Error).message}`);
    }
  }

  private getMessaging(): Promise<any> {
    this.messaging ??= (async () => {
      try {
        const { initializeApp, cert, getApps, getApp } = await import('firebase-admin/app');
        const { getMessaging } = await import('firebase-admin/messaging');
        const json =
          this.config.get<string>('FCM_SERVICE_ACCOUNT_JSON') ??
          readFileSync(this.config.getOrThrow<string>('FCM_SERVICE_ACCOUNT_FILE'), 'utf8');
        const app = getApps().length ? getApp() : initializeApp({ credential: cert(JSON.parse(json)) });
        return getMessaging(app);
      } catch (err) {
        this.logger.error('FCM indisponível', err as Error);
        return null;
      }
    })();
    return this.messaging;
  }

  /** Envia push e devolve os tokens inválidos (para o chamador apagar). */
  async sendPush(tokens: string[], title: string, body: string, data: Record<string, unknown> = {}): Promise<string[]> {
    if (!tokens.length) return [];
    const messaging = await this.getMessaging();
    if (!messaging) return [];
    const strData = Object.fromEntries(
      Object.entries(data)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)]),
    );
    const invalid: string[] = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      try {
        const res = await messaging.sendEachForMulticast({ tokens: chunk, notification: { title, body }, data: strData });
        res.responses.forEach((r: any, idx: number) => {
          const code = r.error?.code;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            invalid.push(chunk[idx]);
          }
        });
      } catch (err) {
        this.logger.warn(`Falha ao enviar push: ${(err as Error).message}`);
      }
    }
    return invalid;
  }
}
