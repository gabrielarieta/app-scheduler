import { paginate } from '../common/pagination.dto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { Role, UserStatus } from '../common/enums';
import { User, UserDocument } from './user.schema';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './users.dto';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly model: Model<User>,
    private readonly config: ConfigService,
  ) {}

  /** Cria o administrador inicial a partir das variáveis de ambiente. */
  async onModuleInit() {
    const email = this.config.get<string>('ADMIN_EMAIL')?.toLowerCase();
    const password = this.config.get<string>('ADMIN_PASSWORD');
    const hasAdmin = await this.model.exists({ role: Role.ADMIN });
    if (hasAdmin) return;
    if (!email || !password) {
      this.logger.warn(
        'Nenhum admin existe e ADMIN_EMAIL/ADMIN_PASSWORD não foram definidos.',
      );
      return;
    }
    const passwordHash = await bcrypt.hash(password, 10);
    await this.model.findOneAndUpdate(
      { email },
      {
        $set: { role: Role.ADMIN, status: UserStatus.ACTIVE, passwordHash },
        $setOnInsert: { name: 'Administrador', email },
      },
      { upsert: true },
    );
    this.logger.log(`Administrador inicial criado: ${email}`);
  }

  async createPending(data: {
    name: string;
    email: string;
    password: string;
    requestedRole?: Role;
  }) {
    const passwordHash = await bcrypt.hash(data.password, 10);
    return this.model.create({
      name: data.name,
      email: data.email,
      passwordHash,
      role: Role.VIEWER,
      status: UserStatus.PENDING,
      requestedRole: data.requestedRole,
    });
  }

  async createByAdmin(dto: CreateUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.model.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      role: dto.role,
      status: UserStatus.ACTIVE,
      unitIds: (dto.unitIds ?? []).map((i) => new Types.ObjectId(i)),
    });
  }

  findByEmailWithPassword(email: string) {
    return this.model
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash');
  }

  findById(id: string) {
    return this.model.findById(id);
  }

  async list(q: ListUsersQueryDto) {
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.role) filter.role = q.role;
    const { limit, skip } = paginate(q);
    const [items, total] = await Promise.all([
      this.model.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      this.model.countDocuments(filter),
    ]);
    return { items, total };
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    if (id === actorId && (dto.role || dto.status)) {
      throw new BadRequestException(
        'Você não pode alterar o próprio perfil ou status.',
      );
    }
    const user = await this.model.findById(id);
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (dto.role) user.role = dto.role;
    if (dto.status) user.status = dto.status;
    if (dto.unitIds) user.unitIds = dto.unitIds.map((i) => new Types.ObjectId(i));
    return user.save();
  }

  /** Busca usuários ativos para o "quem marca" escolher quem poderá consultar. */
  lookup(q?: string) {
    const filter: Record<string, unknown> = { status: UserStatus.ACTIVE };
    if (q?.trim()) {
      const rx = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }];
    }
    return this.model.find(filter).sort({ name: 1 }).limit(20);
  }

  findActiveByIds(ids: string[]): Promise<UserDocument[]> {
    return this.model.find({ _id: { $in: ids }, status: UserStatus.ACTIVE });
  }

  /** Quem aprova reservas: admins e gestores da unidade. */
  findApprovers(unitId?: string) {
    const or: Record<string, unknown>[] = [{ role: Role.ADMIN }];
    if (unitId) or.push({ role: Role.MANAGER, unitIds: new Types.ObjectId(unitId) });
    return this.model.find({ status: UserStatus.ACTIVE, $or: or });
  }

  async getPreferences(userId: string) {
    const u = await this.model.findById(userId);
    if (!u) throw new NotFoundException('Usuário não encontrado');
    return { email: u.prefs?.email !== false, push: u.prefs?.push !== false };
  }

  async setPreferences(userId: string, p: { email?: boolean; push?: boolean }) {
    const u = await this.model.findById(userId);
    if (!u) throw new NotFoundException('Usuário não encontrado');
    u.prefs = { email: p.email ?? u.prefs?.email ?? true, push: p.push ?? u.prefs?.push ?? true };
    u.markModified('prefs');
    await u.save();
    return u.prefs;
  }

  /** Token secreto do feed .ics (criado na 1ª vez; `rotate` invalida o anterior). */
  async calendarToken(userId: string, rotate = false): Promise<string> {
    const u = await this.model.findById(userId).select('+calendarToken');
    if (!u) throw new NotFoundException('Usuário não encontrado');
    if (!u.calendarToken || rotate) {
      u.calendarToken = randomBytes(24).toString('base64url');
      await u.save();
    }
    return u.calendarToken;
  }

  async findByCalendarToken(token: string) {
    const u = await this.model.findOne({ calendarToken: token }).select('+calendarToken');
    return u && u.status === UserStatus.ACTIVE ? u : null;
  }
}
