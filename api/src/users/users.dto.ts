import { IsArray, IsBoolean, IsMongoId } from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';
import { Role, UserStatus } from '../common/enums';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsEnum(Role)
  role: Role;

  @IsOptional() @IsArray() @IsMongoId({ each: true }) unitIds?: string[];
}

export class UpdateUserDto {
  @IsOptional() @IsArray() @IsMongoId({ each: true }) unitIds?: string[];

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class ListUsersQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class LookupQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class PreferencesDto {
  @IsOptional() @IsBoolean() email?: boolean;
  @IsOptional() @IsBoolean() push?: boolean;
}
