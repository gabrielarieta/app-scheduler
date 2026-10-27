import { Controller, Get, Query, Res } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Model } from 'mongoose';
import { Roles } from '../common/decorators';
import { Role } from '../common/enums';
import { paginate } from '../common/pagination.dto';
import { AuditQueryDto } from './audit.dto';
import { AuditLog } from './audit.schema';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(@InjectModel(AuditLog.name) private readonly model: Model<AuditLog>) {}

  @Get()
  @Roles(Role.ADMIN)
  async list(@Query() q: AuditQueryDto, @Res({ passthrough: true }) res: Response) {
    const filter: Record<string, any> = {};
    if (q.entityId) filter.entityId = q.entityId;
    if (q.actorId) filter.actorId = q.actorId;
    if (q.method) filter.method = q.method;
    if (q.from || q.to) {
      filter.at = {};
      if (q.from) filter.at.$gte = new Date(q.from);
      if (q.to) filter.at.$lt = new Date(q.to);
    }
    const { limit, skip } = paginate(q, 100);
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ at: -1 }).skip(skip).limit(limit),
      this.model.countDocuments(filter),
    ]);
    res.setHeader('X-Total-Count', String(total));
    return items;
  }
}
