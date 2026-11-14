import type { ClassConstructor } from 'class-transformer';
import { Buffer } from 'node:buffer';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import {
  BookmarkIdParamDto,
  BulkBookmarksDto,
  CreateBookmarkDto,
  CreateHighlightDto,
  HighlightIdParamDto,
  ListBookmarksQueryDto,
  RenameTagDto,
  ReplaceBookmarkTagsDto,
  TagNameParamDto,
  UpdateBookmarkDto,
  UpdateHighlightDto,
} from '@api/bookmarks/bookmarks.dto';
import { BookmarksService } from '@api/bookmarks/bookmarks.service';
import { BulkBookmarksService } from '@api/bookmarks/bulk-bookmarks.service';
import { HighlightsService } from '@api/bookmarks/highlights.service';
import { TagsService } from '@api/bookmarks/tags.service';
import {
  CollectionIdParamDto,
  CreateCollectionDto,
  DeleteCollectionQueryDto,
  MergeCollectionsDto,
  ReorderCollectionsDto,
  ReplaceBookmarkCollectionsDto,
  UpdateCollectionDto,
} from '@api/collections/collections.dto';
import { CollectionsService } from '@api/collections/collections.service';
import { DuplicatesService } from '@api/library-health/duplicates.service';
import { ResolveDuplicatesDto } from '@api/library-health/library-health.dto';
import { MetadataFetchService } from '@api/metadata/metadata-fetch.service';
import {
  ExportDataDto,
  ExportHighlightsQueryDto,
  ImportDataToolDto,
  MCP_IMPORT_MAX_DECODED_BYTES,
} from '@api/portability/portability.dto';
import { PortabilityService } from '@api/portability/portability.service';
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
 * of the user-facing surface (bookmarks, highlights, collections, tags,
 * library health, bulk operations, sync, reindex). Names ARE the REST
 * `operationId`s; input schemas are generated from the same DTO classes the
 * REST routes validate; every call goes through the SAME services — identical
 * validation, user scoping and change-log semantics. An agent is just another client.
 *
 * NOT mirrored on purpose: `/auth/*` and `/admin/*` (unreachable via PAT),
 * `/me/tokens` (a PAT must not mint credentials), health/icons/metrics
 * (infra, public or non-agent).
 */
export function buildToolCatalog(deps: {
  bookmarks: BookmarksService;
  bulkBookmarks: BulkBookmarksService;
  highlights: HighlightsService;
  tags: TagsService;
  collections: CollectionsService;
  duplicates: DuplicatesService;
  metadata: MetadataFetchService;
  sync: SyncService;
  syncTickets: SyncTicketService;
  portability: PortabilityService;
}): McpToolDefinition[] {
  const {
    bookmarks,
    bulkBookmarks,
    highlights,
    tags,
    collections,
    duplicates,
    metadata,
    sync,
    syncTickets,
    portability,
  } = deps;
  return [
    // -- bookmarks (M3/M6/M10/M11/M12/M13) -----------------------------------
    define(
      'listBookmarks',
      'GET',
      'Search / filter / page bookmarks (including broken-link fields lastCheckedAt/brokenReason/brokenAt). `search` (or alias `q`) parses the canonical M11/M12 operator grammar: `word`, `"exact phrase"` (across title/excerpt/note/url/tags; `\\"` / `\\\\` escapes), `-word` / `-"phrase"` exclusions, `#tag` / `-#tag` / `#"multi word tag"` / `-#"multi word tag"`, field-scoped `title:` / `excerpt:` / `note:` / `link:` (negatable), `type:` (`article|image|video|audio|document|book|link`), `favorite:true|false`, `notag:true|false`, `broken:true|false`, `created:` / `lastUpdate:` with `[<|>|<=|>=]YYYY[-MM[-DD]]` (UTC), and `match:OR` (OR positive terms; exclusions stay ANDed); reserved (`file:`, `reminder:`) and unknown operators fail with 400. Composes via AND with filters: collectionId, tag, domain, unassignedOnly, trashed, favorite, broken, type, updatedSince; sorted by updated-desc (default), created-desc or title-asc; pageSize clamps to 200. Returns { items, totalCount, page, pageSize }.',
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
      'Create a bookmark from a url (stored verbatim) plus optional title/excerpt/note/favorite. Duplicates of the same URL are allowed. Missing title/excerpt and contentType are filled asynchronously from the page (never overwriting provided values). Returns the full bookmark.',
      [CreateBookmarkDto],
      (user, [dto]) => bookmarks.create(user, dto as CreateBookmarkDto),
    ),
    define(
      'updateBookmark',
      'PUT',
      'Update a bookmark. PUT semantics: provided fields replace (including favorite toggle), explicit null clears, absent fields stay; a url change re-runs URL decomposition, clears any broken-link flag, and refreshes cover/icon/contentType from the new page. Refuses trashed bookmarks.',
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
      'bulkBookmarks',
      'POST',
      'Run one transactional bulk operation over up to 500 bookmarks: move (collectionIds, mode assign|union), addTags, removeTags, trash, restore, or delete (hard delete strictly for already-trashed ids). Any invalid id or state conflict rolls back the entire batch with zero events. Returns { action, affected, ids }.',
      [BulkBookmarksDto],
      (user, [dto]) => bulkBookmarks.execute(user, dto as BulkBookmarksDto),
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
      'Re-run the metadata/icon/content-type pipeline for one bookmark (202-style immediate "scheduled" answer; completion lands as a change event). Cover/icon/contentType are re-evaluated, text only fills while still null.',
      [BookmarkIdParamDto],
      (user, [p]) => metadata.reindex(user.id, (p as BookmarkIdParamDto).id),
    ),
    define(
      'getBookmarkStats',
      'GET',
      'Bookmark counts: { total, unassigned, trashed, favorites } over the caller’s bookmarks.',
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

    // -- library health (M12) ------------------------------------------------
    define(
      'findDuplicates',
      'GET',
      'Group the caller’s active URL bookmarks by normalized URL (ignoring scheme, leading www., trailing slash except root /, fragment, and tracking params utm_*/fbclid/gclid/ref/mc_cid/mc_eid). Returns { groups: [{ normalizedUrl, original, extras[] }] } with oldest bookmark as original.',
      [],
      (user) => duplicates.findDuplicates(user.id),
    ),
    define(
      'resolveDuplicates',
      'POST',
      'Merge tags and collection memberships from trashIds into keepId and move trashIds to the trash in one change-logged transaction. Returns { kept, trashedIds }.',
      [ResolveDuplicatesDto],
      (user, [dto]) => duplicates.resolveDuplicates(user.id, dto as ResolveDuplicatesDto),
    ),

    // -- highlights (M10 / D6) ---------------------------------------------
    define(
      'listHighlights',
      'GET',
      'List all highlights for one bookmark in chronological order (trashed bookmarks included). Returns { items }.',
      [BookmarkIdParamDto],
      (user, [p]) => highlights.list(user, (p as BookmarkIdParamDto).id),
    ),
    define(
      'createHighlight',
      'POST',
      'Create a highlight on an active bookmark (text required, optional note and color). Emits a highlight:create change event.',
      [BookmarkIdParamDto, CreateHighlightDto],
      (user, [p, dto]) =>
        highlights.create(user, (p as BookmarkIdParamDto).id, dto as CreateHighlightDto),
    ),
    define(
      'updateHighlight',
      'PUT',
      'Update a highlight’s text, note, or color (explicit null clears note/color). Refuses highlights on trashed bookmarks.',
      [HighlightIdParamDto, UpdateHighlightDto],
      (user, [p, dto]) =>
        highlights.update(user, (p as HighlightIdParamDto).id, dto as UpdateHighlightDto),
    ),
    define(
      'deleteHighlight',
      'DELETE',
      'Permanently delete a highlight and emit a highlight:delete tombstone. Refuses highlights on trashed bookmarks.',
      [HighlightIdParamDto],
      async (user, [p]) => {
        await highlights.delete(user, (p as HighlightIdParamDto).id);
        return undefined;
      },
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

    // -- collections (M4/M13) ----------------------------------------------
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
    define(
      'mergeCollections',
      'POST',
      'Merge active sourceIds into targetId in one change-logged transaction: moves direct children and all bookmark memberships into targetId and soft-trashes sourceIds. Refuses if targetId is a descendant of a source (409) or included in sourceIds (400). Returns { target, trashedIds, movedChildren, movedBookmarks }.',
      [MergeCollectionsDto],
      (user, [dto]) => collections.merge(user, dto as MergeCollectionsDto),
    ),
    define(
      'sortCollectionsAlphabetical',
      'POST',
      'Reorder every sibling level (roots and all nested parents) alphabetically by title in one change-logged transaction. Returns { updated }.',
      [],
      (user) => collections.sortAlphabetical(user),
    ),
    define(
      'deleteEmptyCollections',
      'POST',
      'Soft-trash every active collection whose active subtree contains zero non-trashed bookmarks in one change-logged transaction. Returns { trashed, kept }.',
      [],
      (user) => collections.deleteEmpty(user),
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

    // -- portability (M8/M10) ------------------------------------------------
    define(
      'exportData',
      'POST',
      'Export the caller’s library. format: json (full fidelity — bookmarks incl. favorite/contentType/tags/collections/highlights) | csv | html (Netscape) | txt (one url per line); optional collectionId scopes to that collection’s subtree. json answers structuredContent with the parsed document; the other formats answer the document as text content. Covers the ACTIVE library only (trash excluded). NOTE: POST at REST, so scope=read-only tokens cannot call it — list/changes tools cover reads instead.',
      [ExportDataDto],
      async (user, [dto]) => {
        const request = dto as ExportDataDto;
        const { exportedAt, body } = await portability.exportDocument(
          user,
          request.format,
          request.collectionId,
        );
        if (request.format === 'json') {
          return { exportedAt, document: JSON.parse(body) as unknown };
        }
        return {
          exportedAt,
          format: request.format,
          document: body,
          _note: 'text formats travel as the document string (structuredContent mirrors content)',
        };
      },
    ),
    define(
      'importData',
      'POST',
      'Import bookmarks: base64 `data` + explicit `format` (json = ArcDrop or Raindrop export, csv, html, txt, enex = Evernote web clips only, zip). Decoded cap 1 MiB — bigger uploads (25 MiB file / 300 MB zip) belong to REST POST /data/import. URL-keyed upsert (D13): existing → updated (last-write-wins on updatedAt, tags/memberships/highlights unioned), new → created; returns { created, updated, skipped[], errors[] }.',
      [ImportDataToolDto],
      (user, [dto]) => {
        const request = dto as ImportDataToolDto;
        const compact = request.data.replaceAll(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
          throw new BadRequestException('data must be base64 text');
        }
        const bytes = Buffer.from(compact, 'base64');
        if (bytes.length > MCP_IMPORT_MAX_DECODED_BYTES) {
          throw new PayloadTooLargeException(
            `decoded payload exceeds the ${MCP_IMPORT_MAX_DECODED_BYTES} byte MCP import cap — use REST POST /data/import`,
          );
        }
        return portability.importData(user, request.format, bytes);
      },
    ),
    define(
      'exportBookmarkHighlights',
      'GET',
      'One bookmark’s highlights as txt (quoted text blocks, optional notes) or csv (header text,note,color,createdAt) — returned as the document text.',
      [BookmarkIdParamDto, ExportHighlightsQueryDto],
      async (user, [p, q]) => {
        const download = await portability.exportBookmarkHighlights(
          user,
          (p as BookmarkIdParamDto).id,
          (q as ExportHighlightsQueryDto).format,
        );
        return { format: (q as ExportHighlightsQueryDto).format, body: download.body };
      },
    ),
  ];
}

/** Input JSON Schema for a tool, derived from its DTOs (M7 parity contract). */
export function toolInputSchema(tool: McpToolDefinition): Record<string, unknown> {
  return mergedDtoSchema(tool.dtos);
}
