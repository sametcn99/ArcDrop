import { describe, expect, it } from 'bun:test';
import { buildToolCatalog, toolInputSchema } from './mcp-tool-catalog';
import { dtoSchema } from './dto-schema';
import type { BookmarksService } from '@api/bookmarks/bookmarks.service';
import type { HighlightsService } from '@api/bookmarks/highlights.service';
import type { TagsService } from '@api/bookmarks/tags.service';
import type { CollectionsService } from '@api/collections/collections.service';
import type { MetadataFetchService } from '@api/metadata/metadata-fetch.service';
import type { PortabilityService } from '@api/portability/portability.service';
import type { SyncService } from '@api/sync/sync.service';
import type { SyncTicketService } from '@api/sync/sync-ticket.service';

/** The catalog only ever dispatches — the services are type-level deps here. */
const stubs = {} as {
  bookmarks: BookmarksService;
  highlights: HighlightsService;
  tags: TagsService;
  collections: CollectionsService;
  metadata: MetadataFetchService;
  sync: SyncService;
  syncTickets: SyncTicketService;
  portability: PortabilityService;
};

/** The catalog per the tickets — M8 added portability tools; M10 added highlights CRUD. */
const EXPECTED_TOOLS = [
  'listBookmarks',
  'getBookmark',
  'createBookmark',
  'updateBookmark',
  'deleteBookmark',
  'restoreBookmark',
  'replaceBookmarkTags',
  'replaceBookmarkCollections',
  'reindexBookmark',
  'getBookmarkStats',
  'listBookmarkTags',
  'listHighlights',
  'createHighlight',
  'updateHighlight',
  'deleteHighlight',
  'renameTag',
  'deleteTag',
  'listCollections',
  'getCollectionTree',
  'getCollection',
  'createCollection',
  'updateCollection',
  'deleteCollection',
  'restoreCollection',
  'reorderCollections',
  'getSyncState',
  'listSyncChanges',
  'createSyncTicket',
  'exportData',
  'importData',
  'exportBookmarkHighlights',
] as const;

describe('MCP tool catalog (M7)', () => {
  const catalog = buildToolCatalog(stubs);
  const byName = new Map(catalog.map((tool) => [tool.name, tool]));

  it('contains exactly the v1 tool set, one entry per REST operation', () => {
    expect(catalog.map((tool) => tool.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('names are unique (they double as REST operationIds)', () => {
    expect(new Set(catalog.map((tool) => tool.name)).size).toBe(catalog.length);
  });

  it('derives mutation from the REST method — GET tools are reads, everything else mutates', () => {
    for (const tool of catalog) {
      expect(tool.mutation).toBe(tool.restMethod !== 'GET');
    }
    const reads = catalog.filter((tool) => !tool.mutation).map((tool) => tool.name);
    expect(reads.sort()).toEqual(
      [
        'listBookmarks',
        'getBookmark',
        'getBookmarkStats',
        'listBookmarkTags',
        'listHighlights',
        'listCollections',
        'getCollectionTree',
        'getCollection',
        'getSyncState',
        'listSyncChanges',
        'exportBookmarkHighlights',
      ].sort(),
    );
  });

  it('every tool carries a description and a DTO-derived input schema', () => {
    for (const tool of catalog) {
      expect(tool.description.length).toBeGreaterThan(20);
      const schema = toolInputSchema(tool);
      expect(schema['type']).toBe('object');
      expect(schema['properties']).toBeDefined();
    }
  });

  it('tool input schemas come from the DTO generator, not hand-written text', () => {
    // createBookmark: schema === dtoSchema(CreateBookmarkDto), byte-equal.
    expect(toolInputSchema(byName.get('createBookmark')!)).toEqual(
      dtoSchema(
        // resolve the DTO through the tool itself to prove the linkage
        byName.get('createBookmark')!.dtos[0]!,
      ),
    );
    // composite tool: id + tags body merged flat.
    const replaceTags = toolInputSchema(byName.get('replaceBookmarkTags')!) as Record<
      string,
      unknown
    >;
    expect((replaceTags['required'] as string[]).sort()).toEqual(['id', 'tags'].sort());
    expect(
      (
        (replaceTags['properties'] as Record<string, Record<string, unknown>>)['tags'] as Record<
          string,
          unknown
        >
      )['maxItems'],
    ).toBe(50);
  });

  it('argument-less tools publish an empty object schema', () => {
    const schema = toolInputSchema(byName.get('getBookmarkStats')!);
    expect(schema['type']).toBe('object');
    expect(Object.keys((schema['properties'] as Record<string, unknown>) ?? {})).toEqual([]);
  });

  it('every mutation tool that mutates data has a REST-non-GET method (read-only rule input)', () => {
    for (const tool of catalog) {
      if (tool.mutation) {
        expect(['POST', 'PUT', 'PATCH', 'DELETE']).toContain(tool.restMethod);
      }
    }
  });
});
