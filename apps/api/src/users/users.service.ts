import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, type Repository } from 'typeorm';
import { OneTimeToken } from '@api/database/entities/one-time-token.entity';
import { RefreshToken } from '@api/database/entities/refresh-token.entity';
import { User, type UserRole, type UserStatus } from '@api/database/entities/user.entity';
import type { UserDto } from '@api/auth/auth.dto';
import { toUserDto } from '@api/auth/auth.service';
import {
  INVITE_TOKEN_TTL_MS,
  RESET_TOKEN_TTL_MS,
  TokenService,
} from '@api/auth/crypto/token.service';
import type {
  CreateUserDto,
  CreateUserResponseDto,
  OneTimeTokenDto,
  ResetPasswordResponseDto,
  UpdateUserDto,
} from './users.dto';

/**
 * Admin user management (plan D3/D15): admins create further users; each
 * creation returns a single-use invite token (~24h) in the response body —
 * there is no SMTP in v1. Password resets return a reset token (~1h).
 */
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(OneTimeToken) private readonly oneTimeTokens: Repository<OneTimeToken>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly dataSource: DataSource,
    private readonly tokens: TokenService,
  ) {}

  async list(): Promise<UserDto[]> {
    const rows = await this.users.find({ order: { createdAt: 'ASC' } });
    return rows.map(toUserDto);
  }

  /**
   * Creates a user without a password and returns their invite token —
   * the only copy; the database stores its sha256.
   */
  async create(dto: CreateUserDto): Promise<CreateUserResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const duplicate = await this.users.findOneBy({ email });
    if (duplicate) {
      throw new ConflictException('A user with this email already exists');
    }

    const user = this.users.create({
      email,
      passwordHash: null,
      role: dto.role ?? 'user',
      status: 'active',
    });
    try {
      await this.users.save(user);
    } catch {
      // Lost a race against the unique index.
      throw new ConflictException('A user with this email already exists');
    }

    const invite = await this.issueOneTimeToken(user.id, 'invite', INVITE_TOKEN_TTL_MS);
    return { user: toUserDto(user), invite };
  }

  /**
   * Patches role and/or status. Disabling a user immediately revokes all
   * their refresh tokens (the auth guard also re-checks status per request,
   * so access tokens die on the next call either way). The last active
   * admin cannot be demoted or disabled — that would lock the instance.
   */
  async update(id: string, dto: UpdateUserDto): Promise<UserDto> {
    const user = await this.users.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const nextRole: UserRole = dto.role ?? user.role;
    const nextStatus: UserStatus = dto.status ?? user.status;

    const isLosingAdmin =
      user.role === 'admin' &&
      user.status === 'active' &&
      (nextRole !== 'admin' || nextStatus !== 'active');
    if (isLosingAdmin) {
      const otherActiveAdmins = (
        await this.users.findBy({ role: 'admin', status: 'active' })
      ).filter((row) => row.id !== user.id);
      if (otherActiveAdmins.length === 0) {
        throw new ConflictException('Cannot remove the last active admin');
      }
    }

    user.role = nextRole;
    user.status = nextStatus;
    await this.users.save(user);

    if (nextStatus === 'disabled') {
      // Defense in depth: the guard re-checks status per request anyway,
      // but revoking the refresh tokens makes the logout complete.
      await this.refreshTokens.update({ userId: user.id }, { revokedAt: new Date() });
    }

    return toUserDto(user);
  }

  /**
   * Mints a single-use reset token (~1h). Any still-unused reset token is
   * superseded, so exactly one live reset token exists per user.
   */
  async requestPasswordReset(id: string): Promise<ResetPasswordResponseDto> {
    const user = await this.users.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.oneTimeTokens.update(
      { userId: user.id, type: 'reset', usedAt: IsNull() },
      { usedAt: new Date() },
    );
    const reset = await this.issueOneTimeToken(user.id, 'reset', RESET_TOKEN_TTL_MS);
    return { reset };
  }

  private async issueOneTimeToken(
    userId: string,
    type: 'invite' | 'reset',
    ttlMs: number,
  ): Promise<OneTimeTokenDto> {
    const token = this.tokens.issue(ttlMs);
    const row = this.oneTimeTokens.create({
      userId,
      type,
      tokenHash: token.hash,
      expiresAt: token.expiresAt,
      usedAt: null,
    });
    await this.oneTimeTokens.save(row);
    return { token: token.raw, expiresAt: token.expiresAt };
  }
}
