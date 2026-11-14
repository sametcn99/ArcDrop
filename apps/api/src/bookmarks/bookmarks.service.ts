import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkCollection } from '@api/database/entities/bookmark-collection.entity';
import { BookmarkTag } from '@api/database/entities/bookmark-tag.entity';
import { Collection } from '@api/database/entities/collection.entity';
import { Tag } from '@api/database/entities/tag.entity';
import type { EntityManager, Repository } from 'typeorm';
import { In, IsNull, Not } from 'typeorm';
import { ChangeLogService } from '@api/change-log/change-log.service';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { nextMembershipOrder } from '@api/collections/membership-order';
import { ArchiveStorageService } from '@api/metadata/archive-storage.service';
import { MetadataFetchService } from '@api/metadata/metadata-fetch.service';
import {
  BookmarkArchiveDto,
  BookmarkDto,
  BookmarkListDto,
  BookmarkStatsDto,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type CreateBookmarkDto,
  type ListBookmarksQueryDto,
  type TagDto,
  type UpdateBookmarkDto,
} from './bookmarks.dto';
import { compileSearchQuery, FTS_TEXT_SEARCH_FIELDS } from './search-query.compiler';
import { parseSearchQuery, SearchQueryParseError } from './search-query.parser';
import { TagsService } from './tags.service';
import { UrlDecompositionService } from './url-decomposition.service';

/**
 * Bookmark CRUD, trash/restore, server-side FTS search + paging, archive
 * retrieval, and stats (plan M3, D10/D12/D13/D17; enriched M10; operator
 * grammar M11; broken-link state M12; reminders M14; manual collection sort
 * M16/D21; archive & FTS M17). Every route is user-scoped — a row another user
 * owns simply does not exist (404, never 403: existence is not leaked).
 *
 * Every mutation runs through `ChangeLogService.transact` so the ChangeEvent
 * is appended in the mutation's own transaction with a gapless per-user seq,
 * and the in-process bus hears about it only after the commit.
 *
 * Duplicate urls are ALLOWED (D13) — POST always inserts; there is no
 * upsert anywhere on the create path.
 */
@Injectable()
export class BookmarksService {
  constructor(
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    @InjectRepository(BookmarkTag) private readonly memberships: Repository<BookmarkTag>,
    private readonly urls: UrlDecompositionService,
    private readonly tags: TagsService,
    private readonly changeLog: ChangeLogService,
    private readonly metadata: MetadataFetchService,
    private readonly archives: ArchiveStorageService,
  ) {}

  // -- Reads -----------------------------------------------------------------

  /** One bookmark by id — trash state included (`deletedAt` tells which). */
  async get(user: RequestUser, id: string): Promise<BookmarkDto> {
    const row = await this.bookmarks.findOneBy({ id, userId: user.id });
    if (!row) throw new NotFoundException('Bookmark not found');
    const tags = await this.tagsForBookmarks([row.id]);
    return toBookmarkDto(row, tags.get(row.id) ?? []);
  }

  /** Permanent-copy archive (extracted HTML + plain text) for one owned bookmark (M17). */
  async getArchive(user: RequestUser, id: string): Promise<BookmarkArchiveDto> {
    const row = await this.bookmarks.findOneBy({ id, userId: user.id });
    if (!row) throw new NotFoundException('Bookmark not found');
    if (row.cacheStatus !== 'ready') {
      throw new NotFoundException('Archived copy is not available for this bookmark');
    }
    const stored = await this.archives.read(row.id);
    if (!stored) {
      throw new NotFoundException('Archived copy is not available for this bookmark');
    }
    return {
      bookmarkId: row.id,
      cacheStatus: row.cacheStatus,
      cacheCheckedAt: row.cacheCheckedAt ?? null,
      html: stored.html,
      text: stored.text,
    };
  }

  /**
   * Search + filters + paging (plan D10, M10, M11, M12, M14, M16, M17).
   * Defaults: active set (trashed excluded), sort by `updatedAt` desc,
   * pageSize 20 clamped to 200. `sort=manual` requires `collectionId` (D21)
   * and orders `order ASC NULLS LAST`.
   */
  async list(user: RequestUser, query: ListBookmarksQueryDto): Promise<BookmarkListDto> {
    if (query.search !== undefined && query.q !== undefined) {
      throw new BadRequestException('Provide either "search" or "q", not both');
    }
    if (query.sort === 'manual' && query.collectionId === undefined) {
      throw new BadRequestException(
        'sort=manual requires collectionId — manual order is membership-scoped per collection (D21)',
      );
    }

    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const qb = this.bookmarks
      .createQueryBuilder('b')
      .where('b.userId = :userId', { userId: user.id });

    if (query.trashed) {
      qb.andWhere('b.deletedAt IS NOT NULL');
    } else {
      qb.andWhere('b.deletedAt IS NULL');
    }

    const rawSearch = query.search ?? query.q;
    if (rawSearch !== undefined && rawSearch.trim() !== '') {
      let parsed;
      try {
        parsed = parseSearchQuery(rawSearch, { defaultTextFields: FTS_TEXT_SEARCH_FIELDS });
      } catch (error) {
        if (error instanceof SearchQueryParseError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
      const compiled = compileSearchQuery(parsed, { fts: { userId: user.id } });
      if (compiled !== null) {
        qb.andWhere(compiled.sql, compiled.params);
      }
    }

    if (query.tag !== undefined && query.tag.trim() !== '') {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
           WHERE bt.bookmark_id = b.id AND t.name_lower = :tagLower
        )`,
        { tagLower: query.tag.trim().toLowerCase() },
      );
    }

    if (query.domain !== undefined && query.domain.trim() !== '') {
      qb.andWhere('b.domain = :domain', { domain: query.domain.trim().toLowerCase() });
    }

    if (query.favorite !== undefined) {
      qb.andWhere('b.favorite = :favorite', { favorite: query.favorite });
    }

    if (query.broken === true) {
      qb.andWhere('b.brokenAt IS NOT NULL');
    } else if (query.broken === false) {
      qb.andWhere('b.brokenAt IS NULL');
    }

    if (query.reminder === true) {
      qb.andWhere('b.reminderAt IS NOT NULL');
    } else if (query.reminder === false) {
      qb.andWhere('b.reminderAt IS NULL');
    }

    if (query.type !== undefined) {
      qb.andWhere('b.contentType = :contentType', { contentType: query.type });
    }

    if (query.cacheStatus !== undefined) {
      qb.andWhere('b.cacheStatus = :cacheStatus', { cacheStatus: query.cacheStatus });
    }

    if (query.unassignedOnly) {
      qb.andWhere('NOT EXISTS (SELECT 1 FROM bookmark_collections bc WHERE bc.bookmark_id = b.id)');
    }

    if (query.updatedSince !== undefined) {
      qb.andWhere('b.updatedAt > :since', { since: new Date(query.updatedSince) });
    }

    if (query.collectionId !== undefined) {
      // Active from M4 (D5): membership is membership — the bookmark lists
      // if it has a row in bookmark_collections, regardless of the
      // collection's own trash state (documented in the README).
      if (query.sort === 'manual') {
        qb.innerJoin(
          BookmarkCollection,
          'bc_sort',
          'bc_sort.bookmarkId = b.id AND bc_sort.collectionId = :sortCollectionId',
          { sortCollectionId: query.collectionId },
        );
      } else {
        qb.andWhere(
          `EXISTS (
            SELECT 1 FROM bookmark_collections bc
             WHERE bc.bookmark_id = b.id AND bc.collection_id = :collectionId
          )`,
          { collectionId: query.collectionId },
        );
      }
    }

    const totalCount = await qb.getCount();

    switch (query.sort) {
      case 'created':
        qb.orderBy('b.createdAt', 'DESC');
        break;
      case 'title':
        qb.orderBy('LOWER(b.title)', 'ASC');
        break;
      case 'manual':
        qb.orderBy('bc_sort.order', 'ASC', 'NULLS LAST');
        qb.addOrderBy('bc_sort.createdAt', 'ASC');
        break;
      default:
        qb.orderBy('b.updatedAt', 'DESC');
    }
    qb.addOrderBy('b.id', 'ASC'); // stable paging tie-breaker

    if (query.sort === 'manual') {
      // Safe because bc_sort joins 1:1 on the composite PK (bookmark_id, collection_id)
      // and avoids TypeORM's distinctAlias subquery rewrite on joined ORDER BY columns.
      qb.offset((page - 1) * pageSize).limit(pageSize);
    } else {
      qb.skip((page - 1) * pageSize).take(pageSize);
    }

    const rows = await qb.getMany();
    const tags = await this.tagsForBookmarks(rows.map((row) => row.id));
    return {
      items: rows.map((row) => toBookmarkDto(row, tags.get(row.id) ?? [])),
      totalCount,
      page,
      pageSize,
    };
  }

  /** `{ total, unassigned, trashed, favorites }` over the caller's data (M3/M10). */
  async stats(user: RequestUser): Promise<BookmarkStatsDto> {
    const base = this.bookmarks.createQueryBuilder('b').where('b.userId = :userId', {
      userId: user.id,
    });

    const total = await base.clone().andWhere('b.deletedAt IS NULL').getCount();
    const trashed = await base.clone().andWhere('b.deletedAt IS NOT NULL').getCount();
    const unassigned = await base
      .clone()
      .andWhere('b.deletedAt IS NULL')
      .andWhere('NOT EXISTS (SELECT 1 FROM bookmark_collections bc WHERE bc.bookmark_id = b.id)')
      .getCount();
    const favorites = await base
      .clone()
      .andWhere('b.deletedAt IS NULL')
      .andWhere('b.favorite = true')
      .getCount();

    return { total, unassigned, trashed, favorites };
  }

  // -- Mutations -------------------------------------------------------------

  /**
   * Creates a bookmark — ALWAYS inserts, duplicates included (D13).
   * The url is decomposed once here; the derived parts are never accepted
   * from the client (D12).
   *
   * When `collectionRef` is supplied (quick-add `?collection=`), resolves the
   * active owned collection by UUID or title and attaches the bookmark to it
   * at `MAX(order) + 1` in the same transaction.
   *
   * After the commit, the M6/M10/M17 metadata & archive pipeline is scheduled
   * fire-and-forget: the response below never waits for the fetch, and
   * failures are silent.
   */
  async create(
    user: RequestUser,
    dto: CreateBookmarkDto,
    collectionRef?: string,
  ): Promise<BookmarkDto> {
    const parts = this.urls.decompose(dto.url);
    const trimmedCollection = collectionRef !== undefined ? collectionRef.trim() : undefined;
    if (trimmedCollection === '') {
      throw new BadRequestException('collection must not be empty');
    }
    const reminderAt =
      dto.reminderAt !== undefined && dto.reminderAt !== null
        ? parseReminderAt(dto.reminderAt)
        : null;

    const now = new Date();

    const row = await this.changeLog.transact(async (manager, record) => {
      let targetCollection: Collection | null = null;
      if (trimmedCollection !== undefined) {
        targetCollection = await this.resolveCollectionRef(manager, user.id, trimmedCollection);
        if (!targetCollection) {
          throw new NotFoundException('Collection not found');
        }
      }

      const entity = manager.create(Bookmark, {
        id: randomUUID(), // explicit so the event below can reference it
        userId: user.id,
        url: dto.url,
        title: dto.title ?? null,
        excerpt: dto.excerpt ?? null,
        note: dto.note ?? null,
        favorite: dto.favorite ?? false,
        contentType: 'link',
        coverRef: null,
        iconRef: null,
        lastCheckedAt: null,
        brokenReason: null,
        brokenAt: null,
        reminderAt,
        remindedAt: null,
        cacheStatus: 'pending',
        cacheCheckedAt: null,
        ...parts,
        createdAt: now,
        updatedAt: now,
      });
      await manager.insert(Bookmark, entity);
      // Record bookmark:create BEFORE computing nextMembershipOrder so the
      // users row lock serializes concurrent quick-adds into the same collection.
      await record(user.id, { entity: 'bookmark', entityId: entity.id, action: 'create' });

      if (targetCollection) {
        const order = await nextMembershipOrder(manager, targetCollection.id);
        await manager.insert(BookmarkCollection, {
          bookmarkId: entity.id,
          collectionId: targetCollection.id,
          order,
        });
        await record(user.id, {
          entity: 'collection',
          entityId: targetCollection.id,
          action: 'update',
        });
      }

      return entity;
    });

    this.metadata.scheduleEnrichment(user.id, row.id, row.url, 'fill');
    return toBookmarkDto(row, []);
  }

  /**
   * PUT semantics: provided fields replace (explicit null clears), absent
   * fields stay. A url change re-runs the decomposition (D12), clears any
   * broken-link flag (M12), and resets archive status to `'pending'` (M17).
   * Setting `reminderAt` to a new instant resets `remindedAt` to null; setting
   * `reminderAt` to null clears both `reminderAt` and `remindedAt`; resending
   * the unchanged `reminderAt` preserves `remindedAt` so already-fired
   * reminders never re-arm idempotently. Refuses trashed bookmarks (404 among
   * the active set).
   *
   * A url change also schedules the M6/M17 pipeline in `refresh` mode after
   * commit: coverRef/iconRef/contentType and the permanent archive copy belong
   * to the page THE URL pointed at, so they are re-fetched for the new one.
   */
  async update(user: RequestUser, id: string, dto: UpdateBookmarkDto): Promise<BookmarkDto> {
    let urlChangedTo: string | null = null;
    const result = await this.changeLog.transact(async (manager, record) => {
      const row = await manager.findOne(Bookmark, { where: { id, userId: user.id } });
      if (!row) throw new NotFoundException('Bookmark not found');
      if (row.deletedAt) {
        // The trash is read-only except for restore.
        throw new NotFoundException('Bookmark not found among the active bookmarks');
      }

      const patch: Partial<Bookmark> = {};
      if (dto.url !== undefined) {
        Object.assign(patch, this.urls.decompose(dto.url), { url: dto.url });
        if (dto.url !== row.url) {
          urlChangedTo = dto.url;
          patch.brokenAt = null;
          patch.brokenReason = null;
          patch.lastCheckedAt = null;
          patch.cacheStatus = 'pending';
          patch.cacheCheckedAt = null;
          patch.cacheRetryCount = 0;
          patch.cacheNextRetryAt = null;
          patch.cacheError = null;
          patch.archiveText = null;
        }
      }
      if (dto.title !== undefined) patch.title = dto.title;
      if (dto.excerpt !== undefined) patch.excerpt = dto.excerpt;
      if (dto.note !== undefined) patch.note = dto.note;
      if (dto.favorite !== undefined) patch.favorite = dto.favorite;
      if (dto.reminderAt !== undefined) {
        if (dto.reminderAt === null) {
          patch.reminderAt = null;
          patch.remindedAt = null;
        } else {
          const nextReminderAt = parseReminderAt(dto.reminderAt);
          patch.reminderAt = nextReminderAt;
          if (row.reminderAt === null || row.reminderAt.getTime() !== nextReminderAt.getTime()) {
            patch.remindedAt = null;
          }
        }
      }

      if (Object.keys(patch).length > 0) {
        await manager.update(Bookmark, { id: row.id }, patch); // bumps updatedAt
      }
      await record(user.id, { entity: 'bookmark', entityId: row.id, action: 'update' });

      const fresh = await manager.findOneByOrFail(Bookmark, { id: row.id });
      const tags = await this.tagsForBookmarks([row.id], manager);
      return toBookmarkDto(fresh, tags.get(row.id) ?? []);
    });

    if (urlChangedTo !== null) {
      void this.archives.remove(id).catch(() => {});
      this.metadata.scheduleEnrichment(user.id, id, urlChangedTo, 'refresh');
    }
    return result;
  }

  /**
   * Soft-deletes to the trash (D17). Trashed/unknown ids are 404.
   * Membership rows in `bookmark_collections` (including manual `order` slots)
   * stay intact so restoring returns the bookmark to its prior position (M16).
   */
  async trash(user: RequestUser, id: string): Promise<void> {
    await this.changeLog.transact(async (manager, record) => {
      const result = await manager.update(
        Bookmark,
        { id, userId: user.id, deletedAt: IsNull() },
        { deletedAt: new Date() },
      );
      if ((result.affected ?? 0) === 0) throw new NotFoundException('Bookmark not found');
      await record(user.id, { entity: 'bookmark', entityId: id, action: 'update' });
    });
  }

  /** Moves a trashed bookmark back to the active set (preserving its collection order slots). Active ids are 404. */
  async restore(user: RequestUser, id: string): Promise<BookmarkDto> {
    return this.changeLog.transact(async (manager, record) => {
      const result = await manager.update(
        Bookmark,
        { id, userId: user.id, deletedAt: Not(IsNull()) },
        { deletedAt: null },
      );
      if ((result.affected ?? 0) === 0) throw new NotFoundException('Bookmark not found');
      await record(user.id, { entity: 'bookmark', entityId: id, action: 'update' });

      const fresh = await manager.findOneByOrFail(Bookmark, { id });
      const tags = await this.tagsForBookmarks([id], manager);
      return toBookmarkDto(fresh, tags.get(id) ?? []);
    });
  }

  /**
   * Replaces a bookmark's exact tag set (ticket M3): missing tags are
   * created on demand (each new one records a tag:create event),
   * memberships are replaced wholesale, tags whose last membership vanished
   * are pruned (tag:delete events). The bookmark records one update event.
   */
  async replaceTags(user: RequestUser, id: string, names: readonly string[]): Promise<BookmarkDto> {
    return this.changeLog.transact(async (manager, record) => {
      const row = await manager.findOne(Bookmark, { where: { id, userId: user.id } });
      if (!row) throw new NotFoundException('Bookmark not found');
      if (row.deletedAt) {
        // The trash is read-only except for restore — aligned with PUT /
        // DELETE (M3) and the membership sync (M4). Untagged trash keeps
        // its tag set frozen until it is restored or purged.
        throw new NotFoundException('Bookmark not found among the active bookmarks');
      }

      const wanted = await this.tags.resolveTagNames(manager, user.id, names, record);

      const current = await manager.find(BookmarkTag, { where: { bookmarkId: id } });
      const wantedIds = new Set(wanted.map((tag) => tag.id));
      const currentIds = new Set(current.map((m) => m.tagId));

      const toRemove = current.filter((m) => !wantedIds.has(m.tagId)).map((m) => m.tagId);
      const toAdd = wanted.filter((tag) => !currentIds.has(tag.id));

      if (toRemove.length > 0) {
        await manager.delete(BookmarkTag, { bookmarkId: id, tagId: In(toRemove) });
      }
      if (toAdd.length > 0) {
        await manager.insert(
          BookmarkTag,
          toAdd.map((tag) => ({ bookmarkId: id, tagId: tag.id })),
        );
      }
      if (toRemove.length > 0) {
        await this.tags.pruneOrphanedTags(manager, user.id, record);
      }

      await record(user.id, { entity: 'bookmark', entityId: id, action: 'update' });

      const fresh = await manager.findOneByOrFail(Bookmark, { id });
      const tags = await this.tagsForBookmarks([id], manager);
      return toBookmarkDto(fresh, tags.get(id) ?? []);
    });
  }

  // -- internals -------------------------------------------------------------

  private async resolveCollectionRef(
    manager: EntityManager,
    userId: string,
    ref: string,
  ): Promise<Collection | null> {
    if (isUUID(ref)) {
      return manager.findOne(Collection, {
        where: { id: ref, userId, deletedAt: IsNull() },
      });
    }
    const exact = await manager.findOne(Collection, {
      where: { userId, title: ref, deletedAt: IsNull() },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (exact) return exact;
    return manager
      .createQueryBuilder(Collection, 'c')
      .where('c.userId = :userId', { userId })
      .andWhere('c.deletedAt IS NULL')
      .andWhere('LOWER(c.title) = LOWER(:title)', { title: ref })
      .orderBy('c.createdAt', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .getOne();
  }

  /**
   * Tag views for a set of bookmarks — one query, grouped by bookmark id.
   * Public so the sync module's snapshot assembly (M5) reuses the exact
   * same tag view instead of duplicating the join.
   */
  async tagsForBookmarks(
    ids: readonly string[],
    manager?: EntityManager,
  ): Promise<Map<string, TagDto[]>> {
    const em = manager ?? this.memberships.manager;
    const result = new Map<string, TagDto[]>();
    if (ids.length === 0) return result;

    const rows: Array<{ bookmarkId: string; id: string; name: string }> = await em
      .createQueryBuilder(BookmarkTag, 'bt')
      .innerJoin(Tag, 't', 't.id = bt.tag_id')
      .where('bt.bookmark_id IN (:...ids)', { ids: [...ids] })
      .select(['bt.bookmark_id AS "bookmarkId"', 't.id AS "id"', 't.name AS "name"'])
      .orderBy('t.name_lower', 'ASC')
      .getRawMany();

    for (const row of rows) {
      const list = result.get(row.bookmarkId) ?? [];
      list.push({ id: row.id, name: row.name });
      result.set(row.bookmarkId, list);
    }
    return result;
  }
}

function parseReminderAt(raw: string): Date {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('reminderAt must be a valid ISO-8601 timestamp');
  }
  return parsed;
}

/**
 * Maps a `Bookmark` row to the wire shape. Exported so the sync module's
 * snapshot assembly (M5) serves byte-identical bookmark payloads.
 */
export function toBookmarkDto(row: Bookmark, tags: TagDto[]): BookmarkDto {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    excerpt: row.excerpt,
    note: row.note,
    favorite: row.favorite ?? false,
    contentType: row.contentType ?? 'link',
    coverRef: row.coverRef,
    iconRef: row.iconRef,
    urlParts: {
      scheme: row.scheme,
      host: row.host,
      domain: row.domain,
      port: row.port,
      path: row.path,
      query: row.query,
      fragment: row.fragment,
    },
    tags,
    lastCheckedAt: row.lastCheckedAt ?? null,
    brokenReason: row.brokenReason ?? null,
    brokenAt: row.brokenAt ?? null,
    reminderAt: row.reminderAt ?? null,
    remindedAt: row.remindedAt ?? null,
    cacheStatus: row.cacheStatus ?? 'pending',
    cacheCheckedAt: row.cacheCheckedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null, // in-memory entities may carry undefined
  };
}
