import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkTag } from '@api/database/entities/bookmark-tag.entity';
import { Tag } from '@api/database/entities/tag.entity';
import type { EntityManager, Repository } from 'typeorm';
import { In, IsNull, Not } from 'typeorm';
import { ChangeLogService } from '@api/change-log/change-log.service';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import {
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
import { containsPattern } from './like-pattern';
import { TagsService } from './tags.service';
import { UrlDecompositionService } from './url-decomposition.service';

/**
 * Bookmark CRUD, trash/restore, server-side search + paging and stats
 * (plan M3, D10/D12/D13/D17). Every route is user-scoped — a row another
 * user owns simply does not exist (404, never 403: existence is not leaked).
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
  ) {}

  // -- Reads -----------------------------------------------------------------

  /** One bookmark by id — trash state included (`deletedAt` tells which). */
  async get(user: RequestUser, id: string): Promise<BookmarkDto> {
    const row = await this.bookmarks.findOneBy({ id, userId: user.id });
    if (!row) throw new NotFoundException('Bookmark not found');
    const tags = await this.tagsForBookmarks([row.id]);
    return toBookmarkDto(row, tags.get(row.id) ?? []);
  }

  /**
   * Search + filters + paging (plan D10). Defaults: active set (trashed
   * excluded), sort by `updatedAt` desc, pageSize 20 clamped to 200.
   */
  async list(user: RequestUser, query: ListBookmarksQueryDto): Promise<BookmarkListDto> {
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

    if (query.search !== undefined && query.search.trim() !== '') {
      const pattern = containsPattern(query.search.trim());
      qb.andWhere(
        `(b.title ILIKE :pattern OR b.url ILIKE :pattern OR b.excerpt ILIKE :pattern
          OR EXISTS (
            SELECT 1 FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
             WHERE bt.bookmark_id = b.id AND t.name_lower ILIKE :pattern
          ))`,
        { pattern },
      );
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

    if (query.unassignedOnly) {
      // The bookmark_collections table exists since M3 (D5); memberships
      // only appear from M4 — until then nothing is assigned.
      qb.andWhere('NOT EXISTS (SELECT 1 FROM bookmark_collections bc WHERE bc.bookmark_id = b.id)');
    }

    if (query.updatedSince !== undefined) {
      qb.andWhere('b.updatedAt > :since', { since: new Date(query.updatedSince) });
    }

    // `collectionId` is reserved (ticket M3): accepted + validated, honored
    // from M4 once collections exist.
    void query.collectionId;

    const totalCount = await qb.getCount();

    switch (query.sort) {
      case 'created':
        qb.orderBy('b.createdAt', 'DESC');
        break;
      case 'title':
        qb.orderBy('LOWER(b.title)', 'ASC');
        break;
      default:
        qb.orderBy('b.updatedAt', 'DESC');
    }
    qb.addOrderBy('b.id', 'ASC'); // stable paging tie-breaker
    qb.skip((page - 1) * pageSize).take(pageSize);

    const rows = await qb.getMany();
    const tags = await this.tagsForBookmarks(rows.map((row) => row.id));
    return {
      items: rows.map((row) => toBookmarkDto(row, tags.get(row.id) ?? [])),
      totalCount,
      page,
      pageSize,
    };
  }

  /** `{ total, unassigned, trashed }` over the caller's data (ticket M3). */
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

    return { total, unassigned, trashed };
  }

  // -- Mutations -------------------------------------------------------------

  /**
   * Creates a bookmark — ALWAYS inserts, duplicates included (D13).
   * The url is decomposed once here; the derived parts are never accepted
   * from the client (D12).
   */
  async create(user: RequestUser, dto: CreateBookmarkDto): Promise<BookmarkDto> {
    const parts = this.urls.decompose(dto.url);
    const now = new Date();

    const row = await this.changeLog.transact(async (manager, record) => {
      const entity = manager.create(Bookmark, {
        id: randomUUID(), // explicit so the event below can reference it
        userId: user.id,
        url: dto.url,
        title: dto.title ?? null,
        excerpt: dto.excerpt ?? null,
        note: dto.note ?? null,
        coverRef: null,
        iconRef: null,
        ...parts,
        createdAt: now,
        updatedAt: now,
      });
      await manager.insert(Bookmark, entity);
      await record(user.id, { entity: 'bookmark', entityId: entity.id, action: 'create' });
      return entity;
    });

    return toBookmarkDto(row, []);
  }

  /**
   * PUT semantics: provided fields replace (explicit null clears), absent
   * fields stay. A url change re-runs the decomposition (D12). Refuses
   * trashed bookmarks (404 among the active set).
   */
  async update(user: RequestUser, id: string, dto: UpdateBookmarkDto): Promise<BookmarkDto> {
    return this.changeLog.transact(async (manager, record) => {
      const row = await manager.findOne(Bookmark, { where: { id, userId: user.id } });
      if (!row) throw new NotFoundException('Bookmark not found');
      if (row.deletedAt) {
        // The trash is read-only except for restore.
        throw new NotFoundException('Bookmark not found among the active bookmarks');
      }

      const patch: Partial<Bookmark> = {};
      if (dto.url !== undefined) {
        Object.assign(patch, this.urls.decompose(dto.url), { url: dto.url });
      }
      if (dto.title !== undefined) patch.title = dto.title;
      if (dto.excerpt !== undefined) patch.excerpt = dto.excerpt;
      if (dto.note !== undefined) patch.note = dto.note;

      if (Object.keys(patch).length > 0) {
        await manager.update(Bookmark, { id: row.id }, patch); // bumps updatedAt
      }
      await record(user.id, { entity: 'bookmark', entityId: row.id, action: 'update' });

      const fresh = await manager.findOneByOrFail(Bookmark, { id: row.id });
      const tags = await this.tagsForBookmarks([row.id], manager);
      return toBookmarkDto(fresh, tags.get(row.id) ?? []);
    });
  }

  /** Soft-deletes to the trash (D17). Trashed/unknown ids are 404. */
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

  /** Moves a trashed bookmark back to the active set. Active ids are 404. */
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

  /** Tag views for a set of bookmarks — one query, grouped by bookmark id. */
  private async tagsForBookmarks(
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

function toBookmarkDto(row: Bookmark, tags: TagDto[]): BookmarkDto {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    excerpt: row.excerpt,
    note: row.note,
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? null, // in-memory entities may carry undefined
  };
}
