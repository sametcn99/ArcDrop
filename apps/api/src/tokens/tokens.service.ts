import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { PersonalAccessToken } from '@api/database/entities/personal-access-token.entity';
import { CreatedPersonalAccessTokenDto, PersonalAccessTokenListDto } from './tokens.dto';
import { hashPersonalAccessToken, mintPersonalAccessToken } from './pat-token';

/**
 * Personal access tokens (plan M7) — create / list / revoke for the
 * authenticated user. Tokens are stored hashed (sha256 of the raw value);
 * the raw token exists exactly once, in the create response. Revocation
 * stamps `revokedAt` and keeps the row (listings show the history); a
 * revoked token fails authentication forever after.
 */
@Injectable()
export class TokensService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private get repo() {
    return this.dataSource.getRepository(PersonalAccessToken);
  }

  async create(
    user: RequestUser,
    dto: { name: string; readOnly?: boolean },
  ): Promise<CreatedPersonalAccessTokenDto> {
    const raw = mintPersonalAccessToken();
    const row = this.repo.create({
      userId: user.id,
      tokenHash: hashPersonalAccessToken(raw),
      name: dto.name.trim(),
      readOnly: dto.readOnly ?? false,
    });
    const saved = await this.repo.save(row);
    return {
      id: saved.id,
      name: saved.name,
      readOnly: saved.readOnly,
      token: raw,
      createdAt: saved.createdAt,
      lastUsedAt: saved.lastUsedAt,
      revokedAt: saved.revokedAt,
    };
  }

  async list(user: RequestUser): Promise<PersonalAccessTokenListDto> {
    const rows = await this.repo.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        readOnly: row.readOnly,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
      })),
    };
  }

  /** Revoke one of the caller's tokens (idempotent: revoking twice is a no-op). */
  async revoke(user: RequestUser, id: string): Promise<void> {
    const row = await this.repo.findOneBy({ id, userId: user.id });
    if (!row) {
      // Foreign or unknown ids are indistinguishable (user-scoped 404).
      throw new NotFoundException('Personal access token not found');
    }
    if (row.revokedAt === null) {
      row.revokedAt = new Date();
      await this.repo.save(row);
    }
  }

  /**
   * Best-effort `lastUsedAt` bump — called by the auth guard on every PAT
   * request, fire-and-forget (telemetry, never a reason to fail auth).
   * Skipped once the DataSource is shutting down (no teardown noise).
   */
  touch(patId: string): void {
    if (!this.dataSource.isInitialized) return;
    void this.repo.update({ id: patId }, { lastUsedAt: new Date() }).catch(() => {
      // best effort only
    });
  }
}
