import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkCollection } from '@api/database/entities/bookmark-collection.entity';
import { BookmarkTag } from '@api/database/entities/bookmark-tag.entity';
import { ChangeLogService } from '@api/change-log/change-log.service';
import { BookmarksService, toBookmarkDto } from '@api/bookmarks/bookmarks.service';
import { In, IsNull, type Repository } from 'typeorm';
import type {
  DuplicateGroupDto,
  DuplicateGroupsResponseDto,
  ResolveDuplicatesDto,
  ResolveDuplicatesResponseDto,
} from './library-health.dto';
import { normalizeBookmarkParts } from './url-normalize';

/**
 * Duplicates finder & transactional resolver (plan M12 / D13 / D19, parity G10).
 *
 * Duplicates remain ALLOWED on bookmark creation (D13); this service only
 * surfaces groups of non-trashed URL bookmarks sharing a normalized URL and
 * optionally merges + trashes extras in one change-logged transaction.
 * (File-backed bookmarks arrive in M18 — v1 covers URL bookmarks only.)
 */
@Injectable()
export class DuplicatesService {
  constructor(
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly bookmarksService: BookmarksService,
    private readonly changeLog: ChangeLogService,
  ) {}

  /**
   * Finds all groups of ≥2 active (`deletedAt IS NULL`) bookmarks for `userId`
   * sharing the same normalized URL (`urlParts`-backed). Inside each group, the
   * oldest bookmark (`createdAt ASC, id ASC`) is `original` and newer copies are `extras`.
   */
  async findDuplicates(userId: string): Promise<DuplicateGroupsResponseDto> {
    const rows = await this.bookmarks.find({
      where: { userId, deletedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const grouped = new Map<string, Bookmark[]>();
    for (const row of rows) {
      const key = normalizeBookmarkParts(row);
      const list = grouped.get(key);
      if (list) {
        list.push(row);
      } else {
        grouped.set(key, [row]);
      }
    }

    const duplicateGroups: Array<{ normalizedUrl: string; rows: Bookmark[] }> = [];
    const neededIds: string[] = [];
    for (const [normalizedUrl, list] of grouped) {
      if (list.length < 2) continue;
      duplicateGroups.push({ normalizedUrl, rows: list });
      for (const row of list) neededIds.push(row.id);
    }

    if (duplicateGroups.length === 0) {
      return { groups: [] };
    }

    const tagsByBookmark = await this.bookmarksService.tagsForBookmarks(neededIds);
    const groups: DuplicateGroupDto[] = duplicateGroups.map(({ normalizedUrl, rows: list }) => ({
      normalizedUrl,
      original: toBookmarkDto(list[0]!, tagsByBookmark.get(list[0]!.id) ?? []),
      extras: list.slice(1).map((row) => toBookmarkDto(row, tagsByBookmark.get(row.id) ?? [])),
    }));

    return { groups };
  }

  /**
   * Resolves duplicates in a single change-logged transaction:
   * 1. Validates `keepId` and every `trashIds` entry are active and owned by `userId`
   *    (and `keepId` is not in `trashIds`).
   * 2. Merges unique tags and collection memberships from `trashIds` into `keepId`.
   * 3. Soft-deletes (trashes) every bookmark in `trashIds` (`deletedAt = now`).
   * 4. Records change events for the keeper (when modified), affected collections,
   *    and every trashed duplicate so sync cursors converge completely.
   */
  async resolveDuplicates(
    userId: string,
    dto: ResolveDuplicatesDto,
  ): Promise<ResolveDuplicatesResponseDto> {
    const uniqueTrashIds: string[] = [];
    const seenTrash = new Set<string>();
    for (const id of dto.trashIds) {
      if (id === dto.keepId) {
        throw new BadRequestException('keepId must not appear in trashIds');
      }
      if (!seenTrash.has(id)) {
        seenTrash.add(id);
        uniqueTrashIds.push(id);
      }
    }

    return this.changeLog.transact(async (manager, record) => {
      const allIds = [dto.keepId, ...uniqueTrashIds];
      const rows = await manager.find(Bookmark, {
        where: { userId, id: In(allIds), deletedAt: IsNull() },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));

      if (!byId.has(dto.keepId)) {
        throw new NotFoundException(`Bookmark not found: ${dto.keepId}`);
      }
      for (const trashId of uniqueTrashIds) {
        if (!byId.has(trashId)) {
          throw new NotFoundException(`Bookmark not found: ${trashId}`);
        }
      }

      // 1. Merge tags from trashIds -> keepId
      const existingTagRows = await manager.find(BookmarkTag, {
        where: { bookmarkId: In(allIds) },
      });
      const keeperTagIds = new Set(
        existingTagRows.filter((r) => r.bookmarkId === dto.keepId).map((r) => r.tagId),
      );
      const tagsToAdd: string[] = [];
      const seenNewTags = new Set<string>();
      for (const row of existingTagRows) {
        if (row.bookmarkId === dto.keepId) continue;
        if (!keeperTagIds.has(row.tagId) && !seenNewTags.has(row.tagId)) {
          seenNewTags.add(row.tagId);
          tagsToAdd.push(row.tagId);
        }
      }
      if (tagsToAdd.length > 0) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(BookmarkTag)
          .values(tagsToAdd.map((tagId) => ({ bookmarkId: dto.keepId, tagId })))
          .orIgnore()
          .execute();
      }

      // 2. Merge collection memberships from trashIds -> keepId
      const existingColRows = await manager.find(BookmarkCollection, {
        where: { bookmarkId: In(allIds) },
      });
      const keeperColIds = new Set(
        existingColRows.filter((r) => r.bookmarkId === dto.keepId).map((r) => r.collectionId),
      );
      const colsToAdd: string[] = [];
      const seenNewCols = new Set<string>();
      const touchedCollectionIds = new Set<string>();
      for (const row of existingColRows) {
        if (row.bookmarkId === dto.keepId) continue;
        touchedCollectionIds.add(row.collectionId);
        if (!keeperColIds.has(row.collectionId) && !seenNewCols.has(row.collectionId)) {
          seenNewCols.add(row.collectionId);
          colsToAdd.push(row.collectionId);
        }
      }
      if (colsToAdd.length > 0) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(BookmarkCollection)
          .values(colsToAdd.map((collectionId) => ({ bookmarkId: dto.keepId, collectionId })))
          .orIgnore()
          .execute();
      }

      // 3. Trash extras
      const now = new Date();
      await manager.update(
        Bookmark,
        { id: In(uniqueTrashIds), userId, deletedAt: IsNull() },
        { deletedAt: now },
      );

      // 4. Record change events (keeper if enriched, affected collections, trashed extras)
      if (tagsToAdd.length > 0 || colsToAdd.length > 0) {
        await manager.update(Bookmark, { id: dto.keepId }, { updatedAt: now });
        await record(userId, { entity: 'bookmark', entityId: dto.keepId, action: 'update' });
      }
      for (const collectionId of touchedCollectionIds) {
        await record(userId, { entity: 'collection', entityId: collectionId, action: 'update' });
      }
      for (const trashId of uniqueTrashIds) {
        await record(userId, { entity: 'bookmark', entityId: trashId, action: 'update' });
      }

      const freshKeeper = await manager.findOneByOrFail(Bookmark, { id: dto.keepId });
      const keeperTags = await this.bookmarksService.tagsForBookmarks([dto.keepId], manager);

      return {
        kept: toBookmarkDto(freshKeeper, keeperTags.get(dto.keepId) ?? []),
        trashedIds: uniqueTrashIds,
      };
    });
  }
}
