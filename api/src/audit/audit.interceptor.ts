import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Observable, tap } from 'rxjs';
import { AuditLog } from './audit.schema';

const WRITE = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const SKIP = /^\/api\/(auth\/(login|refresh|logout)|notifications)/;
const SECRET_KEYS = new Set(['password', 'passwordHash', 'refreshToken', 'token', 'code']);

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEYS.has(k) ? '***' : redact(x)]),
    );
  }
  return v;
}

/** Registra quem fez o quê (toda escrita bem-sucedida). Falha de auditoria não afeta a requisição. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');
  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLog>) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    if (!WRITE.has(req.method) || SKIP.test(req.originalUrl ?? '')) return next.handle();

    return next.handle().pipe(
      tap((body: any) => {
        let details: Record<string, unknown> = { params: req.params, body: redact(req.body) };
        if (JSON.stringify(details).length > 4000) details = { params: req.params, truncated: true };
        this.model
          .create({
            actorId: req.user ? new Types.ObjectId(req.user.id) : undefined,
            actorName: req.user?.name,
            actorRole: req.user?.role,
            method: req.method,
            route: req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : req.originalUrl,
            entityId: body?.id ?? req.params?.id,
            statusCode: ctx.switchToHttp().getResponse().statusCode,
            details,
          })
          .catch((e) => this.logger.error('Falha ao gravar auditoria', e));
      }),
    );
  }
}
