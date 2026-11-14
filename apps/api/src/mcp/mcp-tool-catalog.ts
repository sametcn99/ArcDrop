import type { ClassConstructor } from 'class-transformer';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import {
  BookmarkIdParamDto,
  CreateBookmarkDto,
  ListBookmarksQueryDto,
  RenameTagDto,
  ReplaceBookmarkTagsDto,
  TagNameParamDto,
  UpdateBookmarkDto,
} from '@api/bookmarks/bookmarks.dto';
import { BookmarksService } from '@api/bookmarks/bookmarks.service';
import { TagsService } from '@api/bookmarks/tags.service';
import {
  CollectionIdParamDto,
  CreateCollectionDto,
  DeleteCollectionQueryDto,
  ReorderCollectionsDto,
  ReplaceBookmarkCollectionsDto,
  UpdateCollectionDto,
} from '@api/collections/collections.dto';
import { CollectionsService } from '@api/collections/collections.service';
import { MetadataFetchService } from '@api/metadata/metadata-fetch.service';
import { GetSyncChangesQueryDto } from '@api/sync/sync.dto';
import { SyncService } from '@api/sync/sync.service';
import { SyncTicketService } from '@api/sync/sync-ticket.service';
import { mergedDtoSchema } from './dto-schema';

/**
 * The REST method behind each tool. `mutation` is DERIVED from it
 * (`!== GET`) so the read-only refusal can never disagree with the method
 * rule the `PatScopeGuard` applies to the REST route of the same operation.
 */
export type RestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface McpToolDefinition {
  /** The REST `operationId` this tool mirrors (plan M7 naming contract). */
  readonly name: string;
  readonly description: string;
  /** The REST method of the mirrored operation. */
  readonly restMethod: RestMethod;
  /** True when the operation mutates data — refused for read-only tokens. */
  readonly mutation: boolean;
  /**
   * The DTOs whose metadata defines the input schema AND whose validation
   * the arguments pass through (path-param DTO + body DTO when the REST
   * operation takes both). One instance per entry, in order, is passed to
   * `run`.
   */
  readonly dtos: Array<ClassConstructor<unknown>>;
  /** The REST service call — the exact surface REST clients hit. */
  run(principal: RequestUser, instances: object[]): Promise<unknown>;
}

function define(
  name: string,
  restMethod: RestMethod,
  description: string,
  dtos: Array<ClassConstructor<unknown>>,
  run: (principal: RequestUser, instances: object[]) => Promise<unknown>,
): McpToolDefinition {
  return { name, restMethod, description, dtos, mutation: restMethod !== 'GET', run };
}

/**
 * The ArcDrop MCP tool catalog (plan M7/D23) — one tool per REST operation
 * of the user-facing surface (bookmarks, collections, tags, sync,
 * reindex). Names ARE the REST `operationId`s; input schemas are generated
 * from the same DTO classes the REST routes validate; every call goes
 * through the SAME services — identical validation, user scoping and
 * change-log semantics. An agent is just another client.
 *
 * NOT mirrored on purpose: `/auth/*` and `/admin/*` (unreachable via PAT),
 * `/me/tokens` (a PAT must not mint credentials), health/icons/metrics
 * (infra, public or non-agent).
 */
export function buildToolCatalog(deps: {
  bookmarks: BookmarksService;
  tags: TagsService;
  collections: CollectionsService;
  metadata: MetadataFetchService;
  sync: SyncService;
  syncTickets: SyncTicketService;
}): McpToolDefinition[] {
  const { bookmarks, tags, collections, metadata, sync, syncTickets } = deps;
  return [
    // -- bookmarks (M3/M6) -------------------------------------------------
    define(
      'listBookmarks',
      'GET',
      'Search / filter / page bookmarks. Case-insensitive search across title, url, excerpt and tag names; filters: collectionId, tag, domain, unassignedOnly, trashed, updatedSince; sorted by updated-desc (default), created-desc or title-asc; pageSize clamps to 200. Returns { items, totalCount, page, pageSize }.',
      [ListBookmarksQueryDto],
      (user, [query]) => bookmarks.list(user, query as ListBookmarksQueryDto),
    ),
    define(
      'getBookmark',
      'GET',
      'Fetch one bookmark by id (trashed included — the deletedAt field tells which).',
      [BookmarkIdParamDto],
      (user, [p]) => bookmarks.get(user, (p as BookmarkIdParamDto).id),
    ),
    define(
      'createBookmark',
      'POST',
      'Create a bookmark from a url (stored verbatim) plus optional title/excerpt/note. Duplicates of the same URL are allowed. Missing title/excerpt are filled asynchronously from the page (never overwriting provided values). Returns the full bookmark.',
      [CreateBookmarkDto],
      (user, [dto]) => bookmarks.create(user, dto as CreateBookmarkDto),
    ),
    define(
      'updateBookmark',
      'PUT',
      'Update a bookmark. PUT semantics: provided fields replace, explicit null clears, absent fields stay; a url change re-runs URL decomposition and refreshes cover/icon from the new page. Refuses trashed bookmarks.',
      [BookmarkIdParamDto, UpdateBookmarkDto],
      (user, [p, dto]) =>
        bookmarks.update(user, (p as BookmarkIdParamDto).id, dto as UpdateBookmarkDto),
    ),
    define(
      'deleteBookmark',
      'DELETE',
      'Move a bookmark to the trash (soft delete; restoreBookmark undoes it). Hard deletion happens in the daily retention sweep.',
      [BookmarkIdParamDto],
      async (user, [p]) => {
        await bookmarks.trash(user, (p as BookmarkIdParamDto).id);
        return undefined;
      },
    ),
    define(
      'restoreBookmark',
      'POST',
      'Restore a bookmark from the trash. Refuses bookmarks that are not in the trash.',
      [BookmarkIdParamDto],
      (user, [p]) => bookmarks.restore(user, (p as BookmarkIdParamDto).id),
    ),
    define(
      'replaceBookmarkTags',
      'PUT',
      'Replace a bookmark’s exact tag set — missing tags are created on demand, tags left without memberships are pruned. Returns the bookmark with its tags.',
      [BookmarkIdParamDto, ReplaceBookmarkTagsDto],
      (user, [p, dto]) =>
        bookmarks.replaceTags(
          user,
          (p as BookmarkIdParamDto).id,
          (dto as ReplaceBookmarkTagsDto).tags,
        ),
    ),
    define(
      'replaceBookmarkCollections',
      'PUT',
      'Set a bookmark’s exact collection membership (plan D5): the bookmark ends up in exactly the listed collections. Every id must be an active owned collection. Returns { collections: [{ id, title }] }.',
      [BookmarkIdParamDto, ReplaceBookmarkCollectionsDto],
      (user, [p, dto]) =>
        collections.syncBookmarkCollections(
          user,
          (p as BookmarkIdParamDto).id,
          (dto as ReplaceBookmarkCollectionsDto).collectionIds,
        ),
    ),
    define(
      'reindexBookmark',
      'POST',
      'Re-run the metadata/icon pipeline for one bookmark (202-style immediate "scheduled" answer; completion lands as a change event). Cover/icon are replaced, text only fills while still null.',
      [BookmarkIdParamDto],
      (user, [p]) => metadata.reindex(user.id, (p as BookmarkIdParamDto).id),
    ),
    define(
      'getBookmarkStats',
      'GET',
      'Bookmark counts: { total, unassigned, trashed } over the caller’s ACTIVE bookmarks.',
      [],
      (user) => bookmarks.stats(user),
    ),
    define(
      'listBookmarkTags',
      'GET',
      'The caller’s tags with usage counts (ACTIVE bookmarks), sorted by name.',
      [],
      (user) => tags.listUsage(user.id),
    ),

    // -- tags (M3) ---------------------------------------------------------
    define(
      'renameTag',
      'PUT',
      'Rename a tag — or MERGE it into the target when another tag already holds that name (case-insensitive): memberships re-point, the source tag disappears, affected bookmarks record updates. Returns the surviving tag.',
      [TagNameParamDto, RenameTagDto],
      (user, [p, dto]) =>
        tags.renameOrMerge(user.id, (p as TagNameParamDto).name, (dto as RenameTagDto).name),
    ),
    define(
      'deleteTag',
      'DELETE',
      'Delete a tag and detach it from every bookmark. The tag name is matched case-insensitively.',
      [TagNameParamDto],
      async (user, [p]) => {
        await tags.deleteByName(user.id, (p as TagNameParamDto).name);
        return undefined;
      },
    ),

    // -- collections (M4) --------------------------------------------------
    define(
      'listCollections',
      'GET',
      'Flat list of the caller’s ACTIVE collections, grouped per parent (roots first), siblings ordered. bookmarkCount covers ACTIVE bookmarks with a direct membership.',
      [],
      (user) => collections.list(user),
    ),
    define(
      'getCollectionTree',
      'GET',
      'The caller’s collections as a nested tree with DIRECT bookmark counts; a child whose parent is trashed is promoted to the root level.',
      [],
      (user) => collections.tree(user),
    ),
    define(
      'getCollection',
      'GET',
      'Fetch one active collection by id (trashed rows are not found).',
      [CollectionIdParamDto],
      (user, [p]) => collections.get(user, (p as CollectionIdParamDto).id),
    ),
    define(
      'createCollection',
      'POST',
      'Create a root collection — or a child when parentId is set (parent must be active and owned). Appends to the end of its sibling group.',
      [CreateCollectionDto],
      (user, [dto]) => collections.create(user, dto as CreateCollectionDto),
    ),
    define(
      'updateCollection',
      'PUT',
      'Update metadata and/or move a collection. Provided fields replace; icon/color accept explicit null to clear; parentId null moves to the root level; moving under one of its own descendants fails (cycle protection).',
      [CollectionIdParamDto, UpdateCollectionDto],
      (user, [p, dto]) =>
        collections.update(user, (p as CollectionIdParamDto).id, dto as UpdateCollectionDto),
    ),
    define(
      'deleteCollection',
      'DELETE',
      'Two-phase delete: the first call TRASHES the collection (blocked with a conflict while active children exist unless cascade: "trash", which trashes the whole active subtree plus its active bookmarks); the second call on the trashed id HARD-deletes it (memberships die, bookmarks never).',
      [CollectionIdParamDto, DeleteCollectionQueryDto],
      async (user, [p, q]) => {
        await collections.delete(
          user,
          (p as CollectionIdParamDto).id,
          (q as DeleteCollectionQueryDto).cascade === 'trash',
        );
        return undefined;
      },
    ),
    define(
      'restoreCollection',
      'POST',
      'Restore exactly one trashed collection — descendants and their bookmarks stay trashed until individually restored; until the parent is restored the collection appears at the root level.',
      [CollectionIdParamDto],
      (user, [p]) => collections.restore(user, (p as CollectionIdParamDto).id),
    ),
    define(
      'reorderCollections',
      'PATCH',
      'Set explicit sibling positions: items = [{ id, order }] with order ≥ 0. Unspecified siblings keep their positions; rows whose position does not change record no change event.',
      [ReorderCollectionsDto],
      async (user, [dto]) => {
        await collections.reorder(user, dto as ReorderCollectionsDto);
        return undefined;
      },
    ),

    // -- sync (M5) ---------------------------------------------------------
    define(
      'getSyncState',
      'GET',
      'The caller’s current change-log seq ({ seq }) — the cheap poll: compare against your persisted cursor before pulling a delta.',
      [],
      (user) => sync.getState(user.id),
    ),
    define(
      'listSyncChanges',
      'GET',
      'Cursor-based delta: events since a seq in gapless order, each with the entity’s CURRENT snapshot (null for hard-delete tombstones). Returns { resyncRequired, changes, cursor }; resyncRequired means the client must refetch its lists.',
      [GetSyncChangesQueryDto],
      (user, [q]) => {
        const query = q as GetSyncChangesQueryDto;
        return sync.getChanges(user.id, query.since, query.limit);
      },
    ),
    define(
      'createSyncTicket',
      'POST',
      'Mint a one-time websocket ticket (single use, 60 s) for the push channel /api/v1/sync/ws?ticket=… — change notifications {seq, entity, id, action} per committed mutation.',
      [],
      (user) => Promise.resolve(syncTickets.issue(user.id)),
    ),
  ];
}

/** Input JSON Schema for a tool, derived from its DTOs (M7 parity contract). */
export function toolInputSchema(tool: McpToolDefinition): Record<string, unknown> {
  return mergedDtoSchema(tool.dtos);
}
