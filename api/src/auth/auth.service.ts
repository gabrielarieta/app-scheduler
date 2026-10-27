import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Model } from 'mongoose';
import { UserStatus } from '../common/enums';
import { UserDocument } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { LoginDto, RegisterDto } from './auth.dto';
import { RefreshToken } from './refresh-token.schema';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectModel(RefreshToken.name) private readonly refreshModel: Model<RefreshToken>,
  ) {}

  async register(dto: RegisterDto) {
    await this.users.createPending({
      name: dto.name,
      email: dto.email.toLowerCase(),
      password: dto.password,
      requestedRole: dto.requestedRole,
    });
    return { message: 'Solicitação enviada. Aguarde a aprovação do administrador.' };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmailWithPassword(dto.email);
    const ok = user && (await bcrypt.compare(dto.password, user.passwordHash));
    if (!user || !ok) throw new UnauthorizedException('E-mail ou senha inválidos');
    if (user.status === UserStatus.PENDING) throw new ForbiddenException('Seu cadastro ainda aguarda aprovação.');
    if (user.status !== UserStatus.ACTIVE) throw new ForbiddenException('Acesso desativado. Fale com o administrador.');
    return { ...(await this.issue(user)), user: user.toJSON() };
  }

  /** Troca o refresh token por um novo par (rotação: o antigo deixa de valer). */
  async refresh(refreshToken: string) {
    const rec = await this.refreshModel.findOneAndDelete({ _id: hash(refreshToken) });
    if (!rec || rec.expiresAt < new Date()) throw new UnauthorizedException('Sessão expirada');
    const user = await this.users.findById(rec.userId.toString());
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Usuário inativo');
    return { ...(await this.issue(user)), user: user.toJSON() };
  }

  async logout(refreshToken: string) {
    await this.refreshModel.deleteOne({ _id: hash(refreshToken) });
    return { ok: true };
  }

  private async issue(user: UserDocument) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role });
    const refreshToken = randomBytes(48).toString('base64url');
    const days = Number(this.config.get('REFRESH_TOKEN_DAYS') ?? 30);
    await this.refreshModel.create({
      _id: hash(refreshToken),
      userId: user._id,
      expiresAt: new Date(Date.now() + days * 86_400_000),
    });
    return { accessToken, refreshToken };
  }
}
