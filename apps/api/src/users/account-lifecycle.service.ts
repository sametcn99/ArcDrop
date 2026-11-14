import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { PasswordService } from '@api/auth/crypto/password.service';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { User } from '@api/database/entities/user.entity';
import { queryRows } from '@api/database/query-rows';
import { ArchiveStorageService } from '@api/metadata/archive-storage.service';
import { IconEvictionService } from '@api/metadata/icon-eviction.service';

/**
 * Self-service account lifecycle (M15, extended M17):
 * - `resetData`: password-confirmed full wipe of the user's library data
 *   (bookmarks, tags, collections, memberships, highlights, notification
 *   outbox, change events) + `sync_seq = 0`, preserving account, settings,
 *   sessions, PATs, and 2FA enrollment, and removing archived copies on disk.
 * - `deleteAccount`: password-confirmed self-delete with last-active-admin
 *   409 guard and explicit transactional cleanup across all owned tables.
 */
@Injectable()
export class AccountLifecycleService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly passwords: PasswordService,
    private readonly iconEviction: IconEvictionService,
    private readonly archives: ArchiveStorageService,
  ) {}

  async resetData(caller: RequestUser, password: string): Promise<void> {
    const bookmarkIds = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockAndVerifyUser(manager, caller.id, password);
      const ids = await this.wipeLibraryData(manager, user.id);
      await manager.query('UPDATE users SET sync_seq = 0, updated_at = now() WHERE id = $1', [
        user.id,
      ]);
      return ids;
    });

    void this.iconEviction.evictOrphaned().catch(() => {});
    void this.archives.removeMany(bookmarkIds).catch(() => {});
  }

  async deleteAccount(caller: RequestUser, password: string): Promise<void> {
    const bookmarkIds = await this.dataSource.transaction(async (manager) => {
      const user = await this.lockAndVerifyUser(manager, caller.id, password);

      if (user.role === 'admin' && user.status === 'active') {
        const activeAdmins = await queryRows(
          manager,
          `SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id FOR UPDATE`,
        );
        if (activeAdmins.length <= 1) {
          throw new ConflictException('Cannot delete the last active admin');
        }
      }

      const ids = await this.wipeLibraryData(manager, user.id);
      await manager.query('DELETE FROM tfa_recovery_codes WHERE user_id = $1', [user.id]);
      await manager.query('DELETE FROM personal_access_tokens WHERE user_id = $1', [user.id]);
      await manager.query('DELETE FROM refresh_tokens WHERE user_id = $1', [user.id]);
      await manager.query('DELETE FROM one_time_tokens WHERE user_id = $1', [user.id]);
      await manager.query('DELETE FROM users WHERE id = $1', [user.id]);
      return ids;
    });

    void this.iconEviction.evictOrphaned().catch(() => {});
    void this.archives.removeMany(bookmarkIds).catch(() => {});
  }

  private async lockAndVerifyUser(
    manager: EntityManager,
    userId: string,
    password: string,
  ): Promise<User> {
    const user = await manager.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user || user.status !== 'active' || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException('Invalid password');
    }
    return user;
  }

  private async wipeLibraryData(manager: EntityManager, userId: string): Promise<string[]> {
    const bookmarkRows = await queryRows(manager, 'SELECT id FROM bookmarks WHERE user_id = $1', [
      userId,
    ]);
    const bookmarkIds = bookmarkRows.map((row) => String(row.id));

    await manager.query('DELETE FROM notification_outbox WHERE user_id = $1', [userId]);
    await manager.query('DELETE FROM change_events WHERE user_id = $1', [userId]);
    await manager.query('DELETE FROM highlights WHERE user_id = $1', [userId]);
    await manager.query(
      `DELETE FROM bookmark_tags
        WHERE bookmark_id IN (SELECT id FROM bookmarks WHERE user_id = $1)
           OR tag_id IN (SELECT id FROM tags WHERE user_id = $1)`,
      [userId],
    );
    await manager.query(
      `DELETE FROM bookmark_collections
        WHERE bookmark_id IN (SELECT id FROM bookmarks WHERE user_id = $1)
           OR collection_id IN (SELECT id FROM collections WHERE user_id = $1)`,
      [userId],
    );
    await manager.query('DELETE FROM bookmarks WHERE user_id = $1', [userId]);
    await manager.query('DELETE FROM tags WHERE user_id = $1', [userId]);
    await manager.query('DELETE FROM collections WHERE user_id = $1', [userId]);

    return bookmarkIds;
  }
}
