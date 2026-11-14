import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkCollection } from '@api/database/entities/bookmark-collection.entity';
import { BookmarkTag } from '@api/database/entities/bookmark-tag.entity';
import { Collection } from '@api/database/entities/collection.entity';
import { Highlight } from '@api/database/entities/highlight.entity';
import { Tag } from '@api/database/entities/tag.entity';
import { ChangeLogService, type ChangeRecorder } from '@api/change-log/change-log.service';
import {
  lockUserForMembershipAppend,
  nextMembershipOrder,
} from '@api/collections/membership-order';
import { TagsService } from '@api/bookmarks/tags.service';
import { UrlDecompositionService } from '@api/bookmarks/url-decomposition.service';
import { MetadataFetchService } from '@api/metadata/metadata-fetch.service';
import { queryRows } from '@api/database/query-rows';
import { IsNull } from 'typeorm';
import { pickFieldPatch } from './import-merge';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import type { EntityManager, DataSource } from 'typeorm';
import type { ParsedBookmark, ParsedHighlight, ParsedImport } from './import-model';
import type { ImportSummaryDto } from '../portability.dto';

/**
 * How many bookmarks one transaction processes. Import commits in CHUNKS —
 * incremental sync visibility (devices pull progress via `/sync/changes`
 * mid-import), short transactions (the per-user seq lock is held briefly),
 * and restartability: a failed import leaves committed chunks behind and is
 * resumed by re-running it (idempotent — D13 upsert). Per-item failures are
 * caught at PARSE time, so an aborted chunk is a genuine infrastructure
 * error, not data.
 */
const BOOKMARK_CHUNK = 50;

/** Response-size guard: at most this many skipped/error entries come back. */
const MAX_SUMMARY_NOTES = 500;

/** Post-import enrichment runs with this concurrency (never blocks the response). */
const ENRICHMENT_CONCURRENCY = 4;

type PathCache = Map<string, string>; // 'a\u0000b\u0000c' → collection id

const pathKey = (path: readonly string[]): string => path.join('\u0000');

const highlightKey = (h: { text: string; note?: string | null; color?: string | null }): string =>
  `${h.text}\u0000${h.note ?? ''}\u0000${h.color ?? ''}`;

/**
 * The import upsert engine (plan M8/M10, D13): every parsed item is written
 * through the normal domain rules — URL decomposition (D12), tag
 * ci-unique rules, on-demand collection creation from title paths, highlight
 * persistence, and a `ChangeLogService` event per actual CHANGE (D4).
 *
 * Semantics (ratified by the orchestrator, documented in the README):
 * - URL-keyed upsert over ACTIVE rows only, exact verbatim `url` match;
 *   several active duplicates resolve to the most recently updated row.
 * - Field merge is last-write-wins on `updatedAt` (plan D4's conflict
 *   rule): an item older than the row never overwrites non-empty fields;
 *   empty/absent fields never overwrite anything; a null DB field is
 *   filled from the item regardless of age.
 * - Tags, collection memberships, and highlights are UNIONED — import
 *   never detaches or deletes existing entries.
 * - A matched bookmark counts as `updated` whether or not anything
 *   changed, but a change event is recorded ONLY when a field, tag or
 *   membership actually changed (a 1000-bookmark re-import must not
 *   spam the change log / ws push with no-ops).
 * - The trash is not an upsert target: a trashed duplicate absorbs nothing
 *   — a fresh ACTIVE row is created (D13: duplicates are allowed).
 */
@Injectable()
export class ImportUpsertService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly changeLog: ChangeLogService,
    private readonly urls: UrlDecompositionService,
    private readonly tags: TagsService,
    private readonly metadata: MetadataFetchService,
  ) {}

  /**
   * Imports a parsed payload. Parse-level skips/errors travel straight
   * into the summary; collections are ensured first (chunked), then
   * bookmarks in chunks of `BOOKMARK_CHUNK`. Enrichment for created
   * bookmarks is scheduled AFTER the last chunk commits — fire-and-forget
   * with bounded concurrency, exactly like the create path's pipeline.
   */
  async importParsed(user: RequestUser, parsed: ParsedImport): Promise<ImportSummaryDto> {
    const summary: ImportSummaryDto = {
      created: 0,
      updated: 0,
      skipped: parsed.skipped,
      errors: parsed.errors,
    };

    // -- 1. collections (parents before children by path-depth sort) --------
    const collectionCache: PathCache = new Map();
    const collections = this.dedupeCollections(parsed.collections);
    if (collections.length > 0) {
      await this.changeLog.transact(async (manager, record) => {
        for (const collection of collections) {
          await this.ensureCollectionPath(manager, user.id, collection, collectionCache, record);
        }
      });
    }

    // -- 2. bookmarks, chunked ----------------------------------------------
    const createdIds: string[] = [];
    let updatedCount = 0;
    for (let offset = 0; offset < parsed.bookmarks.length; offset += BOOKMARK_CHUNK) {
      const chunk = parsed.bookmarks.slice(offset, offset + BOOKMARK_CHUNK);
      await this.changeLog.transact(async (manager, record) => {
        for (const item of chunk) {
          const createdId = await this.upsertBookmark(manager, user, item, collectionCache, record);
          if (createdId !== null) createdIds.push(createdId);
          else updatedCount++;
        }
      });
    }
    summary.created = createdIds.length;
    summary.updated = updatedCount;

    // -- 3. post-import enrichment (bounded, fire-and-forget) ----------------
    void this.enrichCreated(user.id, createdIds);

    this.capSummaryNotes(summary);
    return summary;
  }

  // -- collections -----------------------------------------------------------

  /**
   * Dedupes collection paths (first definition wins) and orders them
   * parents-first so every prefix exists before its children — and any
   * duplicate-path DIFFERENT definitions collapse to one row (titles are
   * matched case-sensitively; the importer never merges distinct titles).
   */
  private dedupeCollections(collections: ParsedImport['collections']): ParsedImport['collections'] {
    const byKey = new Map<string, ParsedImport['collections'][number]>();
    for (const collection of collections) {
      const key = pathKey(collection.path);
      if (!byKey.has(key)) byKey.set(key, collection);
    }
    return [...byKey.values()].sort((a, b) => a.path.length - b.path.length);
  }

  /**
   * Ensures every path prefix exists (active rows), creating missing
   * segments on demand — the "collection creation from nested paths" rule
   * of the ticket. Creation mirrors `CollectionsService.create`: record
   * the event FIRST (seq-lock ordering), then `MAX(order) + 1` sibling
   * positioning unless the file carried an explicit position.
   */
  private async ensureCollectionPath(
    manager: EntityManager,
    userId: string,
    collection: ParsedImport['collections'][number],
    cache: PathCache,
    record: ChangeRecorder,
  ): Promise<string | null> {
    let parentId: string | null = null;
    let createdId: string | null = null;

    for (let depth = 0; depth < collection.path.length; depth++) {
      const prefix = collection.path.slice(0, depth + 1);
      const key = pathKey(prefix);
      const cached = cache.get(key);
      if (cached !== undefined) {
        parentId = cached;
        continue;
      }

      const title = prefix[depth]!;
      let existing: Collection | null = await manager.findOne(Collection, {
        where: {
          userId,
          parentId: parentId === null ? IsNull() : parentId,
          title,
          deletedAt: IsNull(),
        },
      });
      if (existing === null) {
        const id = randomUUID();
        await record(userId, { entity: 'collection', entityId: id, action: 'create' });
        const order =
          collection.order !== undefined && depth === collection.path.length - 1
            ? collection.order
            : await this.nextSiblingOrder(manager, userId, parentId);
        const entity: Collection = manager.create(Collection, {
          id,
          userId,
          parentId,
          title,
          icon: collection.icon ?? null,
          color: collection.color ?? null,
          order,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        });
        await manager.insert(Collection, entity);
        existing = entity;
        createdId = id;
      }
      cache.set(key, existing.id);
      parentId = existing.id;
    }
    return createdId ?? parentId;
  }

  /** `MAX(order) + 1` over ACTIVE siblings — same rule as M4's create path. */
  private async nextSiblingOrder(
    manager: EntityManager,
    userId: string,
    parentId: string | null,
  ): Promise<number> {
    const rows = await queryRows(
      manager,
      `SELECT COALESCE(MAX("order"), -1) + 1 AS next
         FROM collections
        WHERE user_id = $1
          AND parent_id IS NOT DISTINCT FROM $2::uuid
          AND deleted_at IS NULL`,
      [userId, parentId],
    );
    return Number(rows[0]?.next ?? 0);
  }

  // -- bookmarks -------------------------------------------------------------

  /**
   * One bookmark item. Returns the row id when CREATED (for enrichment),
   * `null` when matched-and-updated. Throws only on infrastructure errors —
   * item-level problems were filtered at parse time.
   */
  private async upsertBookmark(
    manager: EntityManager,
    user: RequestUser,
    item: ParsedBookmark,
    collectionCache: PathCache,
    record: ChangeRecorder,
  ): Promise<string | null> {
    const parts = this.urls.decompose(item.url);

    // Active rows only — exact verbatim match, newest-updated row wins.
    const existingRows = await manager.find(Bookmark, {
      where: { userId: user.id, url: item.url, deletedAt: IsNull() },
      order: { updatedAt: 'DESC', id: 'ASC' },
      take: 1,
    });
    const existing = existingRows[0] ?? null;

    if (existing === null) {
      return this.createBookmark(manager, user, item, parts, collectionCache, record);
    }
    await this.updateBookmark(manager, user, item, existing, collectionCache, record);
    return null;
  }

  private async createBookmark(
    manager: EntityManager,
    user: RequestUser,
    item: ParsedBookmark,
    parts: ReturnType<UrlDecompositionService['decompose']>,
    collectionCache: PathCache,
    record: ChangeRecorder,
  ): Promise<string> {
    const now = new Date();
    const createdAt =
      item.createdAt !== undefined && item.createdAt !== null ? new Date(item.createdAt) : now;
    const updatedAt =
      item.updatedAt !== undefined && item.updatedAt !== null
        ? new Date(item.updatedAt)
        : createdAt;

    const id = randomUUID();
    await record(user.id, { entity: 'bookmark', entityId: id, action: 'create' });
    await manager.insert(Bookmark, {
      id,
      userId: user.id,
      url: item.url,
      title: item.title ?? null,
      excerpt: item.excerpt ?? null,
      note: item.note ?? null,
      favorite: item.favorite ?? false,
      contentType: item.contentType ?? 'link',
      coverRef: null,
      iconRef: null,
      ...parts,
      createdAt,
      updatedAt,
    });

    await this.applyTags(manager, user.id, id, [], item.tags ?? [], record);
    await this.applyCollections(
      manager,
      user,
      id,
      [],
      item.collectionPaths ?? [],
      collectionCache,
      record,
    );
    await this.applyHighlights(manager, user.id, id, [], item.highlights ?? [], record);
    return id;
  }

  private async updateBookmark(
    manager: EntityManager,
    user: RequestUser,
    item: ParsedBookmark,
    row: Bookmark,
    collectionCache: PathCache,
    record: ChangeRecorder,
  ): Promise<void> {
    // Lock users row before updating bookmarks / inserting bookmark_collections
    // so concurrent requests never invert lock order or collide on membership order.
    await lockUserForMembershipAppend(manager, user.id);

    // -- field merge: LWW on updatedAt, empty never overwrites --------------
    const patch: Partial<Bookmark> = { ...pickFieldPatch(row, item) };
    const itemUpdatedAtMs =
      item.updatedAt !== undefined && item.updatedAt !== null ? Date.parse(item.updatedAt) : null;
    const itemNewer =
      itemUpdatedAtMs !== null &&
      !Number.isNaN(itemUpdatedAtMs) &&
      itemUpdatedAtMs > row.updatedAt.getTime();
    if (item.favorite !== undefined && itemNewer && item.favorite !== row.favorite) {
      patch.favorite = item.favorite;
    }
    if (
      item.contentType !== undefined &&
      item.contentType !== row.contentType &&
      (row.contentType === 'link' || itemNewer)
    ) {
      patch.contentType = item.contentType;
    }

    if (Object.keys(patch).length > 0) {
      await manager.update(Bookmark, { id: row.id }, patch); // bumps updatedAt
    }

    // -- tags + memberships + highlights: UNION (import never detaches) -----
    const currentTagRows: Array<{ id: string; name: string }> = await manager
      .createQueryBuilder(BookmarkTag, 'bt')
      .innerJoin(Tag, 't', 't.id = bt.tag_id')
      .where('bt.bookmark_id = :bookmarkId', { bookmarkId: row.id })
      .select(['t.id AS "id"', 't.name AS "name"'])
      .getRawMany();
    const currentTagNames = currentTagRows.map((row_) => row_.name);
    const currentCollectionRows = await manager.find(BookmarkCollection, {
      where: { bookmarkId: row.id },
      select: { collectionId: true },
    });
    const currentHighlightRows = await manager.find(Highlight, {
      where: { bookmarkId: row.id, userId: user.id },
    });

    const changedTags = await this.applyTags(
      manager,
      user.id,
      row.id,
      currentTagNames,
      item.tags ?? [],
      record,
    );
    const changedCollections = await this.applyCollections(
      manager,
      user,
      row.id,
      currentCollectionRows.map((m) => m.collectionId),
      item.collectionPaths ?? [],
      collectionCache,
      record,
    );
    await this.applyHighlights(
      manager,
      user.id,
      row.id,
      currentHighlightRows,
      item.highlights ?? [],
      record,
    );

    if (Object.keys(patch).length > 0 || changedTags || changedCollections) {
      await record(user.id, { entity: 'bookmark', entityId: row.id, action: 'update' });
    }
  }

  /**
   * Ensures the union of `currentNames` and `wantedNames` is attached.
   * Missing tags are created on demand through the normal tag rules
   * (ci-unique, first spelling wins — each new tag records `tag:create`).
   * Returns true when memberships were added.
   */
  private async applyTags(
    manager: EntityManager,
    userId: string,
    bookmarkId: string,
    currentNames: readonly string[],
    wantedNames: readonly string[],
    record: ChangeRecorder,
  ): Promise<boolean> {
    const wanted = new Map<string, string>();
    for (const name of [...currentNames, ...wantedNames]) {
      const trimmed = name.trim();
      if (trimmed.length === 0) continue;
      const lower = trimmed.toLowerCase();
      if (!wanted.has(lower)) wanted.set(lower, trimmed);
    }
    const currentLower = new Set(currentNames.map((name) => name.trim().toLowerCase()));
    const hasNew = [...wanted.keys()].some((lower) => !currentLower.has(lower));
    if (!hasNew) return false; // the union adds nothing — no writes, no events

    const resolved = await this.tags.resolveTagNames(manager, userId, [...wanted.values()], record);
    const toAdd = resolved.filter((tag) => !currentLower.has(tag.nameLower));
    if (toAdd.length === 0) return false;

    await manager.insert(
      BookmarkTag,
      toAdd.map((tag) => ({ bookmarkId, tagId: tag.id })),
    );
    return true;
  }

  /**
   * Ensures every membership path exists (creating collections on demand)
   * and is attached at `MAX(order) + 1`. Existing memberships are never
   * removed. Returns true when memberships were added.
   */
  private async applyCollections(
    manager: EntityManager,
    user: RequestUser,
    bookmarkId: string,
    currentIds: readonly string[],
    paths: readonly string[][],
    cache: PathCache,
    record: ChangeRecorder,
  ): Promise<boolean> {
    const targetIds = new Set<string>(currentIds);
    let added = false;
    for (const path of paths) {
      const collectionId = await this.ensureCollectionPath(
        manager,
        user.id,
        { path },
        cache,
        record,
      );
      if (collectionId === null || targetIds.has(collectionId)) continue;
      const order = await nextMembershipOrder(manager, collectionId);
      await manager.insert(BookmarkCollection, { bookmarkId, collectionId, order });
      targetIds.add(collectionId);
      added = true;
    }
    return added;
  }

  /**
   * Ensures imported highlights not already present on the bookmark are
   * persisted (multiset-matched on `(text, note, color)` so re-imports
   * produce zero duplicates and zero events). Each created highlight
   * preserves its `createdAt` (when supplied) and emits `highlight:create`.
   */
  private async applyHighlights(
    manager: EntityManager,
    userId: string,
    bookmarkId: string,
    existing: readonly Highlight[],
    incoming: readonly ParsedHighlight[],
    record: ChangeRecorder,
  ): Promise<void> {
    if (incoming.length === 0) return;

    const remaining = new Map<string, number>();
    for (const h of existing) {
      const key = highlightKey(h);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    }

    for (const h of incoming) {
      const key = highlightKey(h);
      const count = remaining.get(key) ?? 0;
      if (count > 0) {
        remaining.set(key, count - 1);
        continue;
      }

      const id = randomUUID();
      const createdAt =
        h.createdAt !== undefined && h.createdAt !== null ? new Date(h.createdAt) : new Date();
      await record(userId, { entity: 'highlight', entityId: id, action: 'create' });
      await manager.insert(Highlight, {
        id,
        bookmarkId,
        userId,
        text: h.text,
        note: h.note ?? null,
        color: h.color ?? null,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  // -- post-import enrichment --------------------------------------------------

  /**
   * Fills still-null metadata for CREATED bookmarks with bounded
   * concurrency — the same pipeline a batch of `POST /bookmarks` would
   * trigger, just pooled so a 25 MB upload cannot open thousands of
   * concurrent fetches. Fire-and-forget: never blocks the response,
   * failures are the pipeline's own (silent) business.
   */
  private async enrichCreated(userId: string, ids: readonly string[]): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: ENRICHMENT_CONCURRENCY }, async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++]!;
        try {
          const row = await this.dataSource.manager.findOneBy(Bookmark, { id, userId });
          if (row === null) continue; // purged mid-import — nothing to fill
          await this.metadata.enrich(userId, id, row.url, 'fill');
        } catch {
          // Fire-and-forget by contract (M6): a dropped pool connection or a
          // vanished row is the fill's own business — never a failed import.
        }
      }
    });
    await Promise.all(workers);
  }

  // -- summary shaping ---------------------------------------------------------

  /** Caps `skipped`/`errors` so a hostile upload cannot return megabytes of reasons. */
  private capSummaryNotes(summary: ImportSummaryDto): void {
    for (const key of ['skipped', 'errors'] as const) {
      const notes = summary[key];
      if (notes.length > MAX_SUMMARY_NOTES) {
        const suppressed = notes.length - (MAX_SUMMARY_NOTES - 1);
        summary[key] = [
          ...notes.slice(0, MAX_SUMMARY_NOTES - 1),
          {
            reason: `… ${suppressed} more entries suppressed (list capped at ${MAX_SUMMARY_NOTES})`,
          },
        ];
      }
    }
  }
}
