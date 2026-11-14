import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { ChangeLogService } from '@api/change-log/change-log.service';
import { IconEvictionService } from '@api/metadata/icon-eviction.service';
import { SettingsService } from '@api/settings/settings.service';
import { LessThan, type Repository } from 'typeorm';
import { TagsService } from './tags.service';

export interface PurgeSummary {
  purged: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Trash retention sweep (plan D17): hard-deletes bookmarks that have been
 * in the trash longer than the instance's `trashRetentionDays` (default 30,
 * D16). Runs daily via `TrashPurgeJob`; also callable directly (tests,
 * future admin tooling).
 *
 * The purge emits ChangeEvents like any mutation: one `bookmark:delete`
 * tombstone per purged row, plus `tag:delete` for tags whose last
 * membership vanished with the purged bookmarks. Everything happens in one
 * transaction, so events and deletions commit atomically and seqs stay
 * gapless per user.
 */
@Injectable()
export class TrashPurgeService {
  constructor(
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly settings: SettingsService,
    private readonly tags: TagsService,
    private readonly changeLog: ChangeLogService,
    private readonly iconEviction: IconEvictionService,
  ) {}

  async purgeExpired(now: Date = new Date()): Promise<PurgeSummary> {
    const retentionDays = await this.settings.get('trashRetentionDays');
    const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);

    const expired = await this.bookmarks.find({
      where: { deletedAt: LessThan(cutoff) },
      select: { id: true, userId: true },
    });
    if (expired.length === 0) return { purged: 0 };

    const summary = await this.changeLog.transact(async (manager, record) => {
      await manager.delete(
        Bookmark,
        expired.map((row) => row.id), // memberships CASCADE away with the rows
      );
      for (const row of expired) {
        await record(row.userId, { entity: 'bookmark', entityId: row.id, action: 'delete' });
      }
      // Tags whose memberships all pointed at purged bookmarks are pruned
      // (tag existence invariant), one sweep per affected user.
      for (const userId of new Set(expired.map((row) => row.userId))) {
        await this.tags.pruneOrphanedTags(manager, userId, record);
      }
      return { purged: expired.length };
    });

    // M6 ride-along (ticket): the purge hard-deleted rows, so their icon
    // files may now be orphaned — sweep them fire-and-forget. The daily
    // IconEvictionJob is the safety net either way; never block the purge
    // outcome on a filesystem sweep.
    void this.iconEviction.evictOrphaned().catch(() => {});

    return summary;
  }
}
