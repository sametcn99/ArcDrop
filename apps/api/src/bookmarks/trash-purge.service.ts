import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { Highlight } from '@api/database/entities/highlight.entity';
import { ChangeLogService } from '@api/change-log/change-log.service';
import { ArchiveStorageService } from '@api/metadata/archive-storage.service';
import { IconEvictionService } from '@api/metadata/icon-eviction.service';
import { SettingsService } from '@api/settings/settings.service';
import { In, LessThan, type Repository } from 'typeorm';
import { TagsService } from './tags.service';

export interface PurgeSummary {
  purged: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Trash retention sweep (plan D17, extended M10/M17): hard-deletes bookmarks
 * that have been in the trash longer than `trashRetentionDays` (default 30, D16).
 *
 * The purge emits ChangeEvents like any mutation: one `bookmark:delete`
 * tombstone per purged row, one `highlight:delete` tombstone per cascaded
 * highlight row, plus `tag:delete` for tags whose last membership vanished.
 * On-disk archives and orphaned icons are evicted after commit.
 */
@Injectable()
export class TrashPurgeService {
  constructor(
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly settings: SettingsService,
    private readonly tags: TagsService,
    private readonly changeLog: ChangeLogService,
    private readonly iconEviction: IconEvictionService,
    private readonly archives: ArchiveStorageService,
  ) {}

  async purgeExpired(now: Date = new Date()): Promise<PurgeSummary> {
    const retentionDays = await this.settings.get('trashRetentionDays');
    const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);

    const expired = await this.bookmarks.find({
      where: { deletedAt: LessThan(cutoff) },
      select: { id: true, userId: true },
    });
    if (expired.length === 0) return { purged: 0 };

    const expiredIds = expired.map((row) => row.id);

    const summary = await this.changeLog.transact(async (manager, record) => {
      // Collect cascaded highlight ids BEFORE deleting the parent bookmarks so
      // we can record delete tombstones for syncing devices (M10 AC).
      const highlights = await manager.find(Highlight, {
        where: { bookmarkId: In(expiredIds) },
        select: { id: true, userId: true },
      });

      await manager.delete(
        Bookmark,
        expiredIds, // memberships and highlights CASCADE away with the rows
      );
      for (const row of expired) {
        await record(row.userId, { entity: 'bookmark', entityId: row.id, action: 'delete' });
      }
      for (const highlight of highlights) {
        await record(highlight.userId, {
          entity: 'highlight',
          entityId: highlight.id,
          action: 'delete',
        });
      }
      // Tags whose memberships all pointed at purged bookmarks are pruned
      // (tag existence invariant), one sweep per affected user.
      for (const userId of new Set(expired.map((row) => row.userId))) {
        await this.tags.pruneOrphanedTags(manager, userId, record);
      }
      return { purged: expired.length };
    });

    // M6 ride-along: hard-deleted rows may orphan icon files.
    void this.iconEviction.evictOrphaned().catch(() => {});
    // M17: purge deletes archive bytes on disk.
    void this.archives.removeMany(expiredIds).catch(() => {});

    return summary;
  }
}
