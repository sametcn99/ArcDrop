import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsUUID, MaxLength } from 'class-validator';
import { UserDto } from '@api/auth/auth.dto';

export class CreateUserDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail({}, { message: 'must be an email address' })
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional({ enum: ['admin', 'user'], default: 'user' })
  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: 'admin' | 'user';
}

export class UpdateUserDto {
  @ApiPropertyOptional({ enum: ['admin', 'user'] })
  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: 'admin' | 'user';

  @ApiPropertyOptional({ enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';
}

/** Path param for `/admin/users/{id}` routes. */
export class UserIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class OneTimeTokenDto {
  /** The raw token — the ONLY place it exists outside the client's memory. */
  @ApiProperty({ description: 'Single-use token; store it now, it cannot be retrieved again' })
  token!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}

/** `POST /admin/users` response — the invite token is returned exactly once. */
export class CreateUserResponseDto {
  @ApiProperty({ type: UserDto })
  user!: UserDto;

  @ApiProperty({ type: OneTimeTokenDto, description: 'Valid ~24 hours, single-use' })
  invite!: OneTimeTokenDto;
}

/** `POST /admin/users/{id}/reset-password` response — token returned exactly once. */
export class ResetPasswordResponseDto {
  @ApiProperty({ type: OneTimeTokenDto, description: 'Valid ~1 hour, single-use' })
  reset!: OneTimeTokenDto;
}
