import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const PASSWORD_LENGTH_MESSAGE = 'password must be 8–128 characters';

export class LoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail({}, { message: 'must be an email address' })
  email!: string;

  @ApiProperty({ example: 'correct-horse-battery', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8, { message: PASSWORD_LENGTH_MESSAGE })
  @MaxLength(128, { message: PASSWORD_LENGTH_MESSAGE })
  password!: string;

  /** Human-readable device hint stored with the session; defaults to the User-Agent. */
  @ApiPropertyOptional({ example: 'MacBook Pro — Safari' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceLabel?: string;
}

/** First-run instance bootstrap — creates the admin user (plan D3). */
export class BootstrapDto extends LoginDto {}

/** Open registration — only served while the instance setting is on (D3/D16). */
export class RegisterDto extends LoginDto {}

/** Consumes an invite/reset token and sets the account password (D15). */
export class ClaimDto {
  @ApiProperty({ description: 'The invite or reset token returned by the admin API' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({ example: 'correct-horse-battery', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8, { message: PASSWORD_LENGTH_MESSAGE })
  @MaxLength(128, { message: PASSWORD_LENGTH_MESSAGE })
  password!: string;

  @ApiPropertyOptional({ example: 'Windows Desktop — Firefox' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceLabel?: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'The opaque refresh token from login/refresh/claim' })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

/** Path param for `DELETE /auth/sessions/{id}` (id = refresh-token family id). */
export class SessionIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class LogoutDto {
  @ApiProperty({ description: 'The refresh token of the session to log out' })
  @IsString()
  @MinLength(1)
  refreshToken!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8, { message: PASSWORD_LENGTH_MESSAGE })
  @MaxLength(128, { message: PASSWORD_LENGTH_MESSAGE })
  currentPassword!: string;

  @ApiProperty({ minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8, { message: PASSWORD_LENGTH_MESSAGE })
  @MaxLength(128, { message: PASSWORD_LENGTH_MESSAGE })
  newPassword!: string;
}

export class UserDto {
  @ApiProperty({ example: '5e9f8a3c-…' })
  id!: string;

  @ApiProperty({ example: 'admin@example.com' })
  email!: string;

  @ApiProperty({ enum: ['admin', 'user'] })
  role!: 'admin' | 'user';

  @ApiProperty({ enum: ['active', 'disabled'] })
  status!: 'active' | 'disabled';

  /** False until the invite token has been claimed (plan D15). */
  @ApiProperty()
  hasPassword!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

export class TokenPairDto {
  @ApiProperty({ description: 'HS256 access JWT, valid for 15 minutes' })
  accessToken!: string;

  @ApiProperty({ description: 'Opaque refresh token, valid ~30 days; rotates on use' })
  refreshToken!: string;
}

export class AuthSessionResponseDto extends TokenPairDto {
  @ApiProperty({ type: UserDto })
  user!: UserDto;
}

export class SessionDto {
  /** Stable id of the session — this is the refresh-token family id. */
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'MacBook Pro — Safari' })
  deviceLabel!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true, description: 'Last time the session refreshed its token' })
  lastUsedAt!: Date | null;

  /** True when this session minted the access token used for the call. */
  @ApiProperty()
  current!: boolean;

  /** Set when the session was logged out or revoked (incl. reuse detection). */
  @ApiProperty({ nullable: true })
  revokedAt!: Date | null;
}
