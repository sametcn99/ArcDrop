import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { ChangeLogService, type ChangeRecorder } from '@api/change-log/change-log.service';
import {
  lockUserForMembershipAppend,
  nextMembershipOrder,
} from '@api/collections/membership-order';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkCollection } from '@api/database/entities/bookmark-collection.entity';
import { BookmarkTag } from '@api/database/entities/bookmark-tag.entity';
import { Collection } from '@api/database/entities/collection.entity';
import { Highlight } from '@api/database/entities/highlight.entity';
import { Tag } from '@api/database/entities/tag.entity';
import { queryRows } from '@api/database/query-rows';
import { ArchiveStorageService } from '@api/metadata/archive-storage.service';
import { IconEvictionService } from '@api/metadata/icon-eviction.service';
import { In, IsNull, Not, type EntityManager } from 'typeorm';
import type { BulkBookmarksDto, BulkBookmarksResponseDto } from './bookmarks.dto';
import { TagsService } from './tags.service';

/**
 * Transactional bulk operations over bookmarks (plan M13 / D19, parity G14):
 * `move` (`assign` | `union` collection memberships), `addTags`, `removeTags`,
 * `trash`, `restore`, and `delete` (hard delete, strictly for already-trashed
 * rows per M4 two-phase semantics).
 *
 * Every call runs inside ONE `ChangeLogService.transact` transaction so any
 * mid-list invalid id, foreign id, or trash-state conflict rolls back the
 * entire operation cleanly with zero partial writes and zero change events.
 */
@Injectable()
export class BulkBookmarksService {
  constructor(
    private readonly changeLog: ChangeLogService,
    private readonly tags: TagsService,
    private readonly iconEviction: IconEvictionService,
    private readonly archives: ArchiveStorageService,
  ) {}

  async execute(user: RequestUser, dto: BulkBookmarksDto): Promise<BulkBookmarksResponseDto> {
    const uniqueIds = dedupe(dto.ids);
    const normalizedTags = this.validateActionPayload(dto);

    const result = await this.changeLog.transact(async (manager, record) => {
      const rows = await manager.find(Bookmark, {
        where: { userId: user.id, id: In(uniqueIds) },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));

      this.assertPreconditions(dto.action, uniqueIds, byId);

      switch (dto.action) {
        case 'move':
          return this.applyMove(
            manager,
            user.id,
            uniqueIds,
            dto.collectionIds ?? [],
            dto.mode ?? 'assign',
            record,
          );
        case 'addTags':
          return this.applyAddTags(manager, user.id, uniqueIds, normalizedTags, record);
        case 'removeTags':
          return this.applyRemoveTags(manager, user.id, uniqueIds, normalizedTags, record);
        case 'trash':
          return this.applyTrash(manager, user.id, uniqueIds, record);
        case 'restore':
          return this.applyRestore(manager, user.id, uniqueIds, record);
        case 'delete':
          return this.applyHardDelete(manager, user.id, uniqueIds, record);
      }
    });

    if (dto.action === 'delete' && result.affected > 0) {
      // M6 ride-along: hard-deleted rows may orphan icon files.
      void this.iconEviction.evictOrphaned().catch(() => {});
      // M17: purge deletes archive bytes on disk.
      void this.archives.removeMany(result.ids).catch(() => {});
    }

    return result;
  }

  private validateActionPayload(dto: BulkBookmarksDto): string[] {
    if (dto.action === 'move') {
      if (dto.collectionIds === undefined) {
        throw new BadRequestException('collectionIds is required when action is "move"');
      }
      return [];
    }

    if (dto.action === 'addTags' || dto.action === 'removeTags') {
      if (dto.tags === undefined || dto.tags.length === 0) {
        throw new BadRequestException(
          `tags must be a non-empty array when action is "${dto.action}"`,
        );
      }
      return dto.tags.map((name) => this.tags.normalizeName(name, 'tags'));
    }

    return [];
  }

  private assertPreconditions(
    action: BulkBookmarksDto['action'],
    uniqueIds: readonly string[],
    byId: ReadonlyMap<string, Bookmark>,
  ): void {
    const requiresActive =
      action === 'move' || action === 'addTags' || action === 'removeTags' || action === 'trash';

    for (const id of uniqueIds) {
      const row = byId.get(id);
      if (!row) {
        throw new NotFoundException(`Bookmark not found: ${id}`);
      }
      if (requiresActive && row.deletedAt !== null) {
        throw new NotFoundException(`Bookmark not found among the active bookmarks: ${id}`);
      }
      if (action === 'restore' && row.deletedAt === null) {
        throw new NotFoundException(`Bookmark not found among the trashed bookmarks: ${id}`);
      }
      if (action === 'delete' && row.deletedAt === null) {
        throw new ConflictException(`Bookmark must be trashed before hard delete: ${id}`);
      }
    }
  }

  private async applyMove(
    manager: EntityManager,
    userId: string,
    uniqueIds: readonly string[],
    rawCollectionIds: readonly string[],
    mode: 'assign' | 'union',
    record: ChangeRecorder,
  ): Promise<BulkBookmarksResponseDto> {
    const targetCollectionIds = dedupe(rawCollectionIds);
    if (targetCollectionIds.length > 0) {
      const cols = await manager.find(Collection, {
        where: { userId, id: In(targetCollectionIds), deletedAt: IsNull() },
        select: { id: true },
      });
      const colIds = new Set(cols.map((c) => c.id));
      for (const cid of targetCollectionIds) {
        if (!colIds.has(cid)) {
          throw new NotFoundException(`Collection not found: ${cid}`);
        }
      }
    }

    const existing = await manager.find(BookmarkCollection, {
      where: { bookmarkId: In(uniqueIds) },
    });
    const currentByBookmark = new Map<string, Set<string>>();
    for (const m of existing) {
      let set = currentByBookmark.get(m.bookmarkId);
      if (!set) {
        set = new Set<string>();
        currentByBookmark.set(m.bookmarkId, set);
      }
      set.add(m.collectionId);
    }

    const wantedSet = new Set(targetCollectionIds);
    const removals: Array<{ bookmarkId: string; collectionId: string }> = [];
    const additions: Array<{ bookmarkId: string; collectionId: string }> = [];
    const changedBookmarkIds = new Set<string>();
    const changedCollectionIds = new Set<string>();

    for (const bookmarkId of uniqueIds) {
      const current = currentByBookmark.get(bookmarkId) ?? new Set<string>();
      if (mode === 'assign') {
        for (const cid of current) {
          if (!wantedSet.has(cid)) {
            removals.push({ bookmarkId, collectionId: cid });
            changedBookmarkIds.add(bookmarkId);
            changedCollectionIds.add(cid);
          }
        }
      }
      for (const cid of targetCollectionIds) {
        if (!current.has(cid)) {
          additions.push({ bookmarkId, collectionId: cid });
          changedBookmarkIds.add(bookmarkId);
          changedCollectionIds.add(cid);
        }
      }
    }

    if (removals.length > 0 || additions.length > 0) {
      // Take the user row lock before touching bookmark_collections so
      // MAX(order)+1 appends serialize cleanly with concurrent requests.
      await lockUserForMembershipAppend(manager, userId);
    }

    if (removals.length > 0) {
      await queryRows(
        manager,
        `DELETE FROM bookmark_collections bc
          USING UNNEST($1::uuid[], $2::uuid[]) AS pairs(bookmark_id, collection_id)
          WHERE bc.bookmark_id = pairs.bookmark_id
            AND bc.collection_id = pairs.collection_id`,
        [removals.map((r) => r.bookmarkId), removals.map((r) => r.collectionId)],
      );
    }

    if (additions.length > 0) {
      const nextOrderByCollection = new Map<string, number>();
      const values: Array<{ bookmarkId: string; collectionId: string; order: number }> = [];
      for (const addition of additions) {
        let nextOrder = nextOrderByCollection.get(addition.collectionId);
        if (nextOrder === undefined) {
          nextOrder = await nextMembershipOrder(manager, addition.collectionId);
        }
        values.push({
          bookmarkId: addition.bookmarkId,
          collectionId: addition.collectionId,
          order: nextOrder,
        });
        nextOrderByCollection.set(addition.collectionId, nextOrder + 1);
      }

      await manager
        .createQueryBuilder()
        .insert()
        .into(BookmarkCollection)
        .values(values)
        .orIgnore()
        .execute();
    }

    const affectedIds = uniqueIds.filter((id) => changedBookmarkIds.has(id));
    if (affectedIds.length > 0) {
      await manager.update(Bookmark, { id: In(affectedIds), userId }, { updatedAt: new Date() });
      for (const bookmarkId of affectedIds) {
        await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
      }
      for (const collectionId of changedCollectionIds) {
        await record(userId, { entity: 'collection', entityId: collectionId, action: 'update' });
      }
    }

    return { action: 'move', affected: affectedIds.length, ids: affectedIds };
  }

  private async applyAddTags(
    manager: EntityManager,
    userId: string,
    uniqueIds: readonly string[],
    normalizedTags: readonly string[],
    record: ChangeRecorder,
  ): Promise<BulkBookmarksResponseDto> {
    const resolvedTags = await this.tags.resolveTagNames(manager, userId, normalizedTags, record);
    if (resolvedTags.length === 0) {
      return { action: 'addTags', affected: 0, ids: [] };
    }

    const existing = await manager.find(BookmarkTag, {
      where: {
        bookmarkId: In(uniqueIds),
        tagId: In(resolvedTags.map((t) => t.id)),
      },
    });
    const existingPairs = new Set(existing.map((m) => `${m.bookmarkId}:${m.tagId}`));

    const additions: Array<{ bookmarkId: string; tagId: string }> = [];
    const changedBookmarkIds = new Set<string>();
    for (const bookmarkId of uniqueIds) {
      for (const tag of resolvedTags) {
        const key = `${bookmarkId}:${tag.id}`;
        if (!existingPairs.has(key)) {
          existingPairs.add(key);
          additions.push({ bookmarkId, tagId: tag.id });
          changedBookmarkIds.add(bookmarkId);
        }
      }
    }

    if (additions.length > 0) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(BookmarkTag)
        .values(additions)
        .orIgnore()
        .execute();
    }

    const affectedIds = uniqueIds.filter((id) => changedBookmarkIds.has(id));
    if (affectedIds.length > 0) {
      await manager.update(Bookmark, { id: In(affectedIds), userId }, { updatedAt: new Date() });
      for (const bookmarkId of affectedIds) {
        await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
      }
    }

    return { action: 'addTags', affected: affectedIds.length, ids: affectedIds };
  }

  private async applyRemoveTags(
    manager: EntityManager,
    userId: string,
    uniqueIds: readonly string[],
    normalizedTags: readonly string[],
    record: ChangeRecorder,
  ): Promise<BulkBookmarksResponseDto> {
    const targetLowers = dedupe(normalizedTags.map((name) => name.toLowerCase()));
    const matchedTags = await manager.find(Tag, {
      where: { userId, nameLower: In(targetLowers) },
      select: { id: true },
    });
    if (matchedTags.length === 0) {
      return { action: 'removeTags', affected: 0, ids: [] };
    }

    const removed = await queryRows(
      manager,
      `DELETE FROM bookmark_tags
        WHERE bookmark_id = ANY($1::uuid[])
          AND tag_id = ANY($2::uuid[])
        RETURNING bookmark_id`,
      [uniqueIds, matchedTags.map((t) => t.id)],
    );

    const changedBookmarkIds = new Set(removed.map((r) => String(r.bookmark_id)));
    const affectedIds = uniqueIds.filter((id) => changedBookmarkIds.has(id));

    if (affectedIds.length > 0) {
      await this.tags.pruneOrphanedTags(manager, userId, record);
      await manager.update(Bookmark, { id: In(affectedIds), userId }, { updatedAt: new Date() });
      for (const bookmarkId of affectedIds) {
        await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
      }
    }

    return { action: 'removeTags', affected: affectedIds.length, ids: affectedIds };
  }

  private async applyTrash(
    manager: EntityManager,
    userId: string,
    uniqueIds: readonly string[],
    record: ChangeRecorder,
  ): Promise<BulkBookmarksResponseDto> {
    const now = new Date();
    await manager.update(
      Bookmark,
      { id: In(uniqueIds), userId, deletedAt: IsNull() },
      { deletedAt: now },
    );
    for (const bookmarkId of uniqueIds) {
      await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
    }
    return { action: 'trash', affected: uniqueIds.length, ids: [...uniqueIds] };
  }

  private async applyRestore(
    manager: EntityManager,
    userId: string,
    uniqueIds: readonly string[],
    record: ChangeRecorder,
  ): Promise<BulkBookmarksResponseDto> {
    await manager.update(
      Bookmark,
      { id: In(uniqueIds), userId, deletedAt: Not(IsNull()) },
      { deletedAt: null },
    );
    for (const bookmarkId of uniqueIds) {
      await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
    }
    return { action: 'restore', affected: uniqueIds.length, ids: [...uniqueIds] };
  }

  private async applyHardDelete(
    manager: EntityManager,
    userId: string,
    uniqueIds: readonly string[],
    record: ChangeRecorder,
  ): Promise<BulkBookmarksResponseDto> {
    // Collect cascaded highlight ids BEFORE deleting parent bookmarks so
    // syncing devices receive explicit highlight:delete tombstones (M10 AC).
    const highlights = await manager.find(Highlight, {
      where: { bookmarkId: In(uniqueIds), userId },
      select: { id: true },
    });

    await manager.delete(Bookmark, { id: In(uniqueIds), userId });

    for (const bookmarkId of uniqueIds) {
      await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'delete' });
    }
    for (const highlight of highlights) {
      await record(userId, { entity: 'highlight', entityId: highlight.id, action: 'delete' });
    }
    await this.tags.pruneOrphanedTags(manager, userId, record);

    return { action: 'delete', affected: uniqueIds.length, ids: [...uniqueIds] };
  }
}

function dedupe(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
