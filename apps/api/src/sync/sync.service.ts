import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { toBookmarkDto, BookmarksService } from '@api/bookmarks/bookmarks.service';
import type { TagDto } from '@api/bookmarks/bookmarks.dto';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import type { ChangeEntity } from '@api/database/entities/change-event.entity';
import { Collection } from '@api/database/entities/collection.entity';
import { Tag } from '@api/database/entities/tag.entity';
import { queryRows } from '@api/database/query-rows';
import { In, type DataSource } from 'typeorm';
import {
  CollectionSnapshotDto,
  DEFAULT_SYNC_PAGE_SIZE,
  MAX_SYNC_PAGE_SIZE,
  SyncChangeDto,
  SyncChangesDto,
  SyncStateDto,
  TagSnapshotDto,
  type SyncSnapshot,
} from './sync.dto';
import { MAX_SYNC_SEQ, needsResync } from './sync-resync';

/**
 * The sync read model (plan D4): the change log served as cursor-based
 * deltas. The REST delta is the SOURCE OF TRUTH for clients; the ws
 * gateway (see `SyncGateway`) only sends notifications that a change
 * exists — devices pull `/sync/changes` from their cursor to converge.
 *
 * Snapshots are resolved at delta time: each returned event carries the
 * entity's CURRENT row for create/update (bookmarks reuse `BookmarkDto`
 * exactly — including `urlParts` and `tags`), and a `null` snapshot
 * (tombstone) for delete events — the row is gone; the event is what
 * tells the client it died. Soft delete (trash) is never a tombstone: the
 * snapshot's `deletedAt` carries that state.
 */
@Injectable()
export class SyncService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    // Bookmark snapshots reuse the exact `BookmarkDto` shape (frozen since
    // M3), including per-bookmark tag views — same helper as the REST read
    // paths, so every surface serves identical bookmark payloads.
    private readonly bookmarks: BookmarksService,
  ) {}

  /** The caller's current seq — the cheap poll ("am I behind?"). */
  async getState(userId: string): Promise<SyncStateDto> {
    return { seq: String(await this.currentSeqOf(userId)) };
  }

  /**
   * The delta since a cursor, in seq order. Responses always carry the new
   * cursor; when `resyncRequired` is true the delta is withheld — the
   * client refetches its lists and adopts the returned cursor.
   */
  async getChanges(userId: string, sinceRaw?: string, limitRaw?: number): Promise<SyncChangesDto> {
    const currentSeq = await this.currentSeqOf(userId);
    const since = BigInt(sinceRaw ?? '0');

    // Cursors the counter never issued (restored client state, foreign
    // instance, beyond the pg bigint ceiling) can never have events.
    // Short-circuit BEFORE any bigint cast can fail in SQL.
    if (since > currentSeq || since > MAX_SYNC_SEQ) {
      return { resyncRequired: true, changes: [], cursor: currentSeq.toString() };
    }

    const limit = Math.min(Math.max(limitRaw ?? DEFAULT_SYNC_PAGE_SIZE, 1), MAX_SYNC_PAGE_SIZE);

    const events = await queryRows(
      this.dataSource,
      `SELECT seq, entity, entity_id AS "entityId", action
         FROM change_events
        WHERE user_id = $1 AND seq > $2::bigint
        ORDER BY seq ASC
        LIMIT $3`,
      [userId, since.toString(), limit],
    );

    const minSeq = await this.oldestRetainedSeqOf(userId);
    if (needsResync({ since, minSeq, currentSeq })) {
      return { resyncRequired: true, changes: [], cursor: currentSeq.toString() };
    }

    const changes = await this.withSnapshots(userId, events);
    const last = changes[changes.length - 1];
    const cursor = last ? last.seq : since.toString();
    return { resyncRequired: false, changes, cursor };
  }

  // -- internals --------------------------------------------------------------

  /** `users.sync_seq` — the per-user counter every cursor is measured against. */
  private async currentSeqOf(userId: string): Promise<bigint> {
    const rows = await queryRows(this.dataSource, 'SELECT sync_seq FROM users WHERE id = $1', [
      userId,
    ]);
    const seq = rows[0]?.sync_seq;
    if (seq === undefined) {
      // Unreachable behind the JWT guard (it loads the user from the DB);
      // a missing user must not silently read as seq 0.
      throw new UnauthorizedException('User not found');
    }
    return BigInt(String(seq));
  }

  /** Smallest retained event seq for the user, or null when none remain. */
  private async oldestRetainedSeqOf(userId: string): Promise<bigint | null> {
    const rows = await queryRows(
      this.dataSource,
      'SELECT MIN(seq) AS "minSeq" FROM change_events WHERE user_id = $1',
      [userId],
    );
    const raw = rows[0]?.minSeq;
    return raw === undefined || raw === null ? null : BigInt(String(raw));
  }

  /**
   * Attaches snapshots to a page of events: one batched query per entity
   * type over the page's ids (never per event). Delete events keep a null
   * snapshot; a missing row on create/update (the entity vanished without
   * a delete event — impossible through the API) is served as a tombstone
   * too, which converges clients in every case.
   */
  private async withSnapshots(
    userId: string,
    events: ReadonlyArray<Record<string, unknown>>,
  ): Promise<SyncChangeDto[]> {
    const changes: SyncChangeDto[] = events.map((event) => ({
      seq: String(event.seq),
      entity: event.entity as ChangeEntity,
      id: String(event.entityId),
      action: event.action as SyncChangeDto['action'],
      snapshot: null,
    }));

    const wanted: Record<ChangeEntity, string[]> = { bookmark: [], tag: [], collection: [] };
    for (const change of changes) {
      if (change.action !== 'delete' && !wanted[change.entity].includes(change.id)) {
        wanted[change.entity].push(change.id);
      }
    }

    const manager = this.dataSource.manager;
    const bookmarks = wanted.bookmark.length
      ? await manager.find(Bookmark, { where: { id: In(wanted.bookmark), userId } })
      : [];
    const tags = wanted.tag.length
      ? await manager.find(Tag, { where: { id: In(wanted.tag), userId } })
      : [];
    const collections = wanted.collection.length
      ? await manager.find(Collection, { where: { id: In(wanted.collection), userId } })
      : [];
    const tagViews = wanted.bookmark.length
      ? await this.bookmarks.tagsForBookmarks(wanted.bookmark, manager)
      : new Map<string, TagDto[]>();

    const bookmarkById = new Map(bookmarks.map((row) => [row.id, row]));
    const tagById = new Map(tags.map((row) => [row.id, row]));
    const collectionById = new Map(collections.map((row) => [row.id, row]));

    for (const change of changes) {
      if (change.action === 'delete') continue;
      let snapshot: SyncSnapshot = null;
      switch (change.entity) {
        case 'bookmark': {
          const row = bookmarkById.get(change.id);
          if (row) snapshot = toBookmarkDto(row, tagViews.get(change.id) ?? []);
          break;
        }
        case 'tag': {
          const row = tagById.get(change.id);
          if (row) {
            snapshot = {
              id: row.id,
              name: row.name,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            } satisfies TagSnapshotDto;
          }
          break;
        }
        case 'collection': {
          const row = collectionById.get(change.id);
          if (row) {
            snapshot = {
              id: row.id,
              parentId: row.parentId,
              title: row.title,
              icon: row.icon,
              color: row.color,
              order: row.order,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              deletedAt: row.deletedAt ?? null,
            } satisfies CollectionSnapshotDto;
          }
          break;
        }
      }
      change.snapshot = snapshot;
    }

    return changes;
  }
}
