import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { toJSONOptions } from '../common/json';
import { Role, UserStatus } from '../common/enums';

@Schema({ timestamps: true, toJSON: toJSONOptions })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ type: String, enum: Object.values(Role), default: Role.VIEWER })
  role: Role;

  @Prop({
    type: String,
    enum: Object.values(UserStatus),
    default: UserStatus.PENDING,
    index: true,
  })
  status: UserStatus;

  /** Perfil que a pessoa pediu no cadastro (o admin decide o definitivo). */
  @Prop({ type: String, enum: [Role.RESERVER, Role.VIEWER] })
  requestedRole?: Role;

  /** Unidades (campi) da pessoa. Admin global ignora; gestor administra estas; demais só as usam. */
  @Prop({ type: [Types.ObjectId], default: [] })
  unitIds: Types.ObjectId[];

  /** Segredo da URL do feed .ics (somente leitura). */
  @Prop({ type: String, unique: true, sparse: true, select: false })
  calendarToken?: string;

  /** Canais de aviso (além das notificações dentro do app). */
  @Prop({ type: Object, default: { email: true, push: true } })
  prefs: { email: boolean; push: boolean };
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
