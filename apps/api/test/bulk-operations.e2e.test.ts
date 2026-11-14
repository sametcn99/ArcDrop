import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { buildCollectionTree } from '../src/collections/tree-builder';
import { installTestEnv } from './helpers';

/**
 * M13 — Bulk operations (e2e):
 * - `POST /bookmarks/bulk` (`move` assign/union, `addTags`, `removeTags`,
 *   `trash`, `restore`, `delete` two-phase hard delete + highlight tombstones)
 * - 500-id cap + payload validation + mid-list invalid id atomic rollback
 * - `POST /collections/merge` (children + memberships + source trash + 409 descendant cycle)
 * - `POST /collections/sort-alphabetical` (all sibling levels + tree check + idempotency)
 * - `POST /collections/delete-empty` (recursive empty subtree incl. trashed-only bookmarks)
 * - Sync coherence + 2nd-device cursor-only catch-up reconstruction
 * - MCP tools parity + read-only PAT enforcement
 * - Isolated per-user `'bulk'` rate limit shared between REST and MCP
 */

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
}

interface TagView {
  id: string;
  name: string;
}

interface BookmarkView {
  id: string;
  url: string;
  title: string | null;
  tags: TagView[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface BookmarkListView {
  items: BookmarkView[];
  totalCount: number;
}

interface HighlightView {
  id: string;
  bookmarkId: string;
  text: string;
  note: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CollectionView {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  order: number;
  bookmarkCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CollectionNodeView extends CollectionView {
  children: CollectionNodeView[];
}

interface BulkBookmarksResult {
  action: string;
  affected: number;
  ids: string[];
}

interface MergeCollectionsResult {
  target: CollectionView;
  trashedIds: string[];
  movedChildren: number;
  movedBookmarks: number;
}

interface SyncChangeItem {
  seq: string;
  entity: 'bookmark' | 'tag' | 'collection' | 'highlight';
  id: string;
  action: 'create' | 'update' | 'delete';
  snapshot: Record<string, unknown> | null;
}

interface SyncChangesView {
  resyncRequired: boolean;
  changes: SyncChangeItem[];
  cursor: string;
}

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: string };
}

interface CallResult<T> {
  status: number;
  body: T;
  contentType: string;
}

async function call<T = Record<string, unknown>>(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  init: { body?: unknown; bearer?: string } = {},
): Promise<CallResult<T>> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.bearer) headers['authorization'] = `Bearer ${init.bearer}`;
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = (
    contentType.includes('json') ? ((await res.json()) as T) : ((await res.text()) as unknown as T)
  ) as T;
  return { status: res.status, body, contentType };
}

const problem = (r: CallResult<unknown>) => r.body as unknown as Problem;

async function mcpPost(
  baseUrl: string,
  bearer: string,
  body: unknown,
  sessionId?: string,
): Promise<{
  status: number;
  sessionId?: string;
  message: {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  } | null;
}> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${bearer}`,
  };
  if (sessionId !== undefined) headers['mcp-session-id'] = sessionId;
  const res = await fetch(`${baseUrl}/api/v1/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type') ?? '';
  let message: {
    result?: Record<string, unknown>;
    error?: { code: number; message: string };
  } | null = null;
  if (contentType.includes('event-stream')) {
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      message = JSON.parse(line.slice(5).trim()) as typeof message;
    }
  } else if (contentType.includes('json')) {
    const text = await res.text();
    if (text.length > 0) message = JSON.parse(text) as typeof message;
  }
  return {
    status: res.status,
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
    message,
  };
}

async function bootApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
  document: OpenAPIObject;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const config = loadConfig();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(0);
  return { app, baseUrl: await app.getUrl(), document };
}

async function wipeData(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM audit_log_entries');
  await dataSource.query('DELETE FROM personal_access_tokens');
  await dataSource.query('DELETE FROM change_events');
  await dataSource.query('DELETE FROM highlights');
  await dataSource.query('DELETE FROM bookmark_tags');
  await dataSource.query('DELETE FROM bookmark_collections');
  await dataSource.query('DELETE FROM tags');
  await dataSource.query('DELETE FROM bookmarks');
  await dataSource.query('DELETE FROM collections');
  await dataSource.query('DELETE FROM refresh_tokens');
  await dataSource.query('DELETE FROM one_time_tokens');
  await dataSource.query('DELETE FROM users');
  await dataSource.query('DELETE FROM settings');
}

async function bootstrapAdmin(baseUrl: string): Promise<AuthSession> {
  const res = await call<AuthSession>(baseUrl, 'POST', '/auth/bootstrap', {
    body: { email: 'root@arcdrop.test', password: 'root-password-1' },
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function createUserViaAdmin(
  baseUrl: string,
  admin: AuthSession,
  email: string,
): Promise<AuthSession> {
  const res = await call<{ invite: { token: string } }>(baseUrl, 'POST', '/admin/users', {
    bearer: admin.accessToken,
    body: { email },
  });
  expect(res.status).toBe(201);
  const claim = await call<AuthSession>(baseUrl, 'POST', '/auth/claim', {
    body: { token: res.body.invite.token, password: 'user-password-1' },
  });
  expect(claim.status).toBe(201);
  return claim.body;
}

async function loginUser(baseUrl: string, email: string): Promise<AuthSession> {
  const res = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
    body: { email, password: 'user-password-1' },
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe('Bulk operations M13 (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  describe('boot A — bookmarks bulk, collections merge/sort/delete-empty, rollback, sync, MCP', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let document: OpenAPIObject;
    let admin: AuthSession;
    let alice: AuthSession;
    let aliceDevice2: AuthSession;
    let bob: AuthSession;
    let aliceRwPat: string;
    let aliceRoPat: string;
    let savedBulkLimit: string | undefined;

    const resetAliceData = async () => {
      await dataSource.query('DELETE FROM change_events WHERE user_id = $1', [alice.user.id]);
      await dataSource.query('DELETE FROM highlights WHERE user_id = $1', [alice.user.id]);
      await dataSource.query(
        'DELETE FROM bookmark_tags WHERE bookmark_id IN (SELECT id FROM bookmarks WHERE user_id = $1)',
        [alice.user.id],
      );
      await dataSource.query(
        'DELETE FROM bookmark_collections WHERE bookmark_id IN (SELECT id FROM bookmarks WHERE user_id = $1)',
        [alice.user.id],
      );
      await dataSource.query('DELETE FROM tags WHERE user_id = $1', [alice.user.id]);
      await dataSource.query('DELETE FROM bookmarks WHERE user_id = $1', [alice.user.id]);
      await dataSource.query('DELETE FROM collections WHERE user_id = $1', [alice.user.id]);
    };

    const createBm = async (bearer: string, url: string, title: string) => {
      const res = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer,
        body: { url, title },
      });
      expect(res.status).toBe(201);
      return res.body;
    };

    const createCol = async (bearer: string, title: string, parentId?: string) => {
      const res = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer,
        body: parentId ? { title, parentId } : { title },
      });
      expect(res.status).toBe(201);
      return res.body;
    };

    beforeAll(async () => {
      savedBulkLimit = process.env['ARCDROP__RATE_LIMIT__BULK_PER_MINUTE'];
      process.env['ARCDROP__RATE_LIMIT__BULK_PER_MINUTE'] = '1000';
      installTestEnv();
      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      document = booted.document;
      dataSource = app.get(DataSource);

      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      alice = await createUserViaAdmin(baseUrl, admin, 'alice-bulk@arcdrop.test');
      aliceDevice2 = await loginUser(baseUrl, 'alice-bulk@arcdrop.test');
      bob = await createUserViaAdmin(baseUrl, admin, 'bob-bulk@arcdrop.test');

      const rw = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
        bearer: alice.accessToken,
        body: { name: 'Bulk RW', readOnly: false },
      });
      expect(rw.status).toBe(201);
      aliceRwPat = rw.body.token;

      const ro = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
        bearer: alice.accessToken,
        body: { name: 'Bulk RO', readOnly: true },
      });
      expect(ro.status).toBe(201);
      aliceRoPat = ro.body.token;
    }, 60_000);

    afterAll(async () => {
      if (savedBulkLimit === undefined) delete process.env['ARCDROP__RATE_LIMIT__BULK_PER_MINUTE'];
      else process.env['ARCDROP__RATE_LIMIT__BULK_PER_MINUTE'] = savedBulkLimit;

      await new Promise((resolve) => setTimeout(resolve, 60));
      await app?.close();
    });

    it('OpenAPI exposes all four M13 bulk operationIds', () => {
      const paths = document.paths as Record<string, { post?: { operationId?: string } }>;
      expect(paths['/api/v1/bookmarks/bulk']?.post?.operationId).toBe('bulkBookmarks');
      expect(paths['/api/v1/collections/merge']?.post?.operationId).toBe('mergeCollections');
      expect(paths['/api/v1/collections/sort-alphabetical']?.post?.operationId).toBe(
        'sortCollectionsAlphabetical',
      );
      expect(paths['/api/v1/collections/delete-empty']?.post?.operationId).toBe(
        'deleteEmptyCollections',
      );
    });

    it('validates 500-id caps and required action payloads with 400 problem+json', async () => {
      const emptyBulk = await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'trash', ids: [] },
      });
      expect(emptyBulk.status).toBe(400);
      expect(emptyBulk.contentType.startsWith('application/problem+json')).toBe(true);
      expect(problem(emptyBulk).code).toBe('VALIDATION_FAILED');

      const overCapIds = Array.from({ length: 501 }, () => crypto.randomUUID());
      const tooManyBookmarks = await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'trash', ids: overCapIds },
      });
      expect(tooManyBookmarks.status).toBe(400);
      expect(problem(tooManyBookmarks).code).toBe('VALIDATION_FAILED');

      const missingMoveCols = await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'move', ids: [crypto.randomUUID()] },
      });
      expect(missingMoveCols.status).toBe(400);
      expect(problem(missingMoveCols).code).toBe('BAD_REQUEST');

      const emptyTags = await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'addTags', ids: [crypto.randomUUID()], tags: [] },
      });
      expect(emptyTags.status).toBe(400);
      expect(problem(emptyTags).code).toBe('BAD_REQUEST');

      const mergeSelf = await call(baseUrl, 'POST', '/collections/merge', {
        bearer: alice.accessToken,
        body: { sourceIds: [overCapIds[0]!], targetId: overCapIds[0]! },
      });
      expect(mergeSelf.status).toBe(400);
      expect(problem(mergeSelf).code).toBe('BAD_REQUEST');

      const mergeOverCap = await call(baseUrl, 'POST', '/collections/merge', {
        bearer: alice.accessToken,
        body: { sourceIds: overCapIds, targetId: crypto.randomUUID() },
      });
      expect(mergeOverCap.status).toBe(400);
      expect(problem(mergeOverCap).code).toBe('VALIDATION_FAILED');
    });

    it('AC: POST /bookmarks/bulk executes move (assign + union concurrent memberships), addTags, removeTags, trash, restore, and two-phase delete', async () => {
      await resetAliceData();

      const colA = await createCol(alice.accessToken, 'Col A');
      const colB = await createCol(alice.accessToken, 'Col B');
      const colC = await createCol(alice.accessToken, 'Col C');
      const colD = await createCol(alice.accessToken, 'Col D');

      const bm1 = await createBm(alice.accessToken, 'https://bulk.example.com/1', 'Bulk 1');
      const bm2 = await createBm(alice.accessToken, 'https://bulk.example.com/2', 'Bulk 2');
      const bm3 = await createBm(alice.accessToken, 'https://bulk.example.com/3', 'Bulk 3');

      // bm1 lives in BOTH colA and colB (concurrent membership AC); bm2 lives in colB.
      await call(baseUrl, 'PUT', `/bookmarks/${bm1.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [colA.id, colB.id] },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${bm2.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [colB.id] },
      });

      // 1a. move (union): bm1 & bm2 gain colC + colD while keeping existing memberships
      const moveUnion = await call<BulkBookmarksResult>(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: {
          action: 'move',
          ids: [bm1.id, bm2.id],
          collectionIds: [colC.id, colD.id],
          mode: 'union',
        },
      });
      expect(moveUnion.status).toBe(200);
      expect(moveUnion.body).toEqual({ action: 'move', affected: 2, ids: [bm1.id, bm2.id] });

      const inA = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${colA.id}`,
        {
          bearer: alice.accessToken,
        },
      );
      const inB = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${colB.id}`,
        {
          bearer: alice.accessToken,
        },
      );
      const inC = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${colC.id}`,
        {
          bearer: alice.accessToken,
        },
      );
      const inD = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${colD.id}`,
        {
          bearer: alice.accessToken,
        },
      );
      expect(inA.body.items.map((b) => b.id)).toEqual([bm1.id]);
      expect(inB.body.items.map((b) => b.id).sort()).toEqual([bm1.id, bm2.id].sort());
      expect(inC.body.items.map((b) => b.id).sort()).toEqual([bm1.id, bm2.id].sort());
      expect(inD.body.items.map((b) => b.id).sort()).toEqual([bm1.id, bm2.id].sort());

      // 1b. move (assign): replaces memberships wholesale on bm2 & bm3 -> [colD]
      const moveAssign = await call<BulkBookmarksResult>(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: {
          action: 'move',
          ids: [bm2.id, bm3.id],
          collectionIds: [colD.id],
          mode: 'assign',
        },
      });
      expect(moveAssign.status).toBe(200);
      expect(moveAssign.body.affected).toBe(2);

      const inBAfter = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${colB.id}`,
        { bearer: alice.accessToken },
      );
      const inDAfter = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${colD.id}`,
        { bearer: alice.accessToken },
      );
      expect(inBAfter.body.items.map((b) => b.id)).toEqual([bm1.id]);
      expect(inDAfter.body.items.map((b) => b.id).sort()).toEqual([bm1.id, bm2.id, bm3.id].sort());

      // 2. addTags: ci-unique spelling preserved, duplicate additions skipped cleanly
      await call(baseUrl, 'PUT', `/bookmarks/${bm1.id}/tags`, {
        bearer: alice.accessToken,
        body: { tags: ['Work'] },
      });
      const addTags = await call<BulkBookmarksResult>(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: {
          action: 'addTags',
          ids: [bm1.id, bm2.id],
          tags: ['work', 'Urgent'],
        },
      });
      expect(addTags.status).toBe(200);
      expect(addTags.body).toEqual({ action: 'addTags', affected: 2, ids: [bm1.id, bm2.id] });

      const bm1AfterTags = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${bm1.id}`, {
        bearer: alice.accessToken,
      });
      const bm2AfterTags = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${bm2.id}`, {
        bearer: alice.accessToken,
      });
      expect(bm1AfterTags.body.tags.map((t) => t.name).sort()).toEqual(['Urgent', 'Work']);
      expect(bm2AfterTags.body.tags.map((t) => t.name).sort()).toEqual(['Urgent', 'Work']);

      // Re-adding identical tags affects 0 rows
      const addSameTags = await call<BulkBookmarksResult>(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'addTags', ids: [bm1.id, bm2.id], tags: ['WORK'] },
      });
      expect(addSameTags.status).toBe(200);
      expect(addSameTags.body).toEqual({ action: 'addTags', affected: 0, ids: [] });

      // 3. removeTags: case-insensitive removal + orphan tag pruning
      const removeTags = await call<BulkBookmarksResult>(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'removeTags', ids: [bm1.id, bm2.id], tags: ['urgent'] },
      });
      expect(removeTags.status).toBe(200);
      expect(removeTags.body).toEqual({ action: 'removeTags', affected: 2, ids: [bm1.id, bm2.id] });

      const tagUsage = await call<Array<{ name: string; count: number }>>(
        baseUrl,
        'GET',
        '/bookmarks/tags',
        { bearer: alice.accessToken },
      );
      expect(tagUsage.body.map((t) => t.name)).toEqual(['Work']);

      // 4. trash & restore
      const trashed = await call<BulkBookmarksResult>(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'trash', ids: [bm1.id, bm3.id] },
      });
      expect(trashed.status).toBe(200);
      expect(trashed.body).toEqual({ action: 'trash', affected: 2, ids: [bm1.id, bm3.id] });

      const activeList = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks', {
        bearer: alice.accessToken,
      });
      expect(activeList.body.items.map((b) => b.id)).toEqual([bm2.id]);

      const trashList = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?trashed=true', {
        bearer: alice.accessToken,
      });
      expect(trashList.body.items.map((b) => b.id).sort()).toEqual([bm1.id, bm3.id].sort());

      const restored = await call<BulkBookmarksResult>(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'restore', ids: [bm1.id, bm3.id] },
      });
      expect(restored.status).toBe(200);
      expect(restored.body).toEqual({ action: 'restore', affected: 2, ids: [bm1.id, bm3.id] });

      // 5. delete: active bookmark triggers 409 CONFLICT; trashed bookmark hard-deletes with highlight tombstone
      const hl = await call<HighlightView>(baseUrl, 'POST', `/bookmarks/${bm3.id}/highlights`, {
        bearer: alice.accessToken,
        body: { text: 'Highlight to cascade tombstone' },
      });
      expect(hl.status).toBe(201);

      const activeDeleteRefused = await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'delete', ids: [bm3.id] },
      });
      expect(activeDeleteRefused.status).toBe(409);
      expect(problem(activeDeleteRefused).code).toBe('CONFLICT');

      await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'trash', ids: [bm3.id] },
      });
      const seqBeforeHardDelete = (
        await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
      ).body.seq;

      const hardDeleted = await call<BulkBookmarksResult>(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'delete', ids: [bm3.id] },
      });
      expect(hardDeleted.status).toBe(200);
      expect(hardDeleted.body).toEqual({ action: 'delete', affected: 1, ids: [bm3.id] });

      const gone = await call(baseUrl, 'GET', `/bookmarks/${bm3.id}`, {
        bearer: alice.accessToken,
      });
      expect(gone.status).toBe(404);

      const deleteChanges = await call<SyncChangesView>(
        baseUrl,
        'GET',
        `/sync/changes?since=${seqBeforeHardDelete}`,
        { bearer: alice.accessToken },
      );
      expect(
        deleteChanges.body.changes.some(
          (c) => c.entity === 'bookmark' && c.id === bm3.id && c.action === 'delete',
        ),
      ).toBe(true);
      expect(
        deleteChanges.body.changes.some(
          (c) => c.entity === 'highlight' && c.id === hl.body.id && c.action === 'delete',
        ),
      ).toBe(true);
    });

    it('AC: mid-list invalid/foreign/wrong-state IDs roll back atomically with zero DB changes and zero sync events', async () => {
      await resetAliceData();

      const colA = await createCol(alice.accessToken, 'Rollback A');
      const colB = await createCol(alice.accessToken, 'Rollback B');
      const bobCol = await createCol(bob.accessToken, 'Bob Secret');

      const bm1 = await createBm(alice.accessToken, 'https://rb.example.com/1', 'RB 1');
      const bm2 = await createBm(alice.accessToken, 'https://rb.example.com/2', 'RB 2');
      const bmTrashed = await createBm(alice.accessToken, 'https://rb.example.com/3', 'RB Trashed');
      const bobBm = await createBm(bob.accessToken, 'https://rb.example.com/bob', 'Bob BM');

      await call(baseUrl, 'PUT', `/bookmarks/${bm1.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [colA.id] },
      });
      await call(baseUrl, 'DELETE', `/bookmarks/${bmTrashed.id}`, { bearer: alice.accessToken });

      const seqBefore = (
        await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
      ).body.seq;

      // Case 1: nonexistent UUID mid-list on trash
      const midUnknown = await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'trash', ids: [bm1.id, crypto.randomUUID(), bm2.id] },
      });
      expect(midUnknown.status).toBe(404);
      expect(midUnknown.contentType.startsWith('application/problem+json')).toBe(true);
      expect(problem(midUnknown).code).toBe('NOT_FOUND');

      // Case 2: foreign bookmark mid-list on addTags
      const midForeign = await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'addTags', ids: [bm1.id, bobBm.id, bm2.id], tags: ['never-created'] },
      });
      expect(midForeign.status).toBe(404);
      expect(problem(midForeign).code).toBe('NOT_FOUND');

      // Case 3: foreign collection on move
      const badTargetCol = await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'move', ids: [bm1.id, bm2.id], collectionIds: [bobCol.id], mode: 'union' },
      });
      expect(badTargetCol.status).toBe(404);

      // Case 4: active bookmark mid-list on hard delete -> 409, trashed sibling MUST NOT be deleted
      const midActiveOnDelete = await call(baseUrl, 'POST', '/bookmarks/bulk', {
        bearer: alice.accessToken,
        body: { action: 'delete', ids: [bmTrashed.id, bm1.id] },
      });
      expect(midActiveOnDelete.status).toBe(409);
      expect(problem(midActiveOnDelete).code).toBe('CONFLICT');

      // Case 5: mid-list nonexistent source on POST /collections/merge
      const mergeBadSource = await call(baseUrl, 'POST', '/collections/merge', {
        bearer: alice.accessToken,
        body: { sourceIds: [colA.id, crypto.randomUUID()], targetId: colB.id },
      });
      expect(mergeBadSource.status).toBe(404);

      // Verify ZERO partial state and ZERO sync events!
      const seqAfter = (
        await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
      ).body.seq;
      expect(seqAfter).toBe(seqBefore);

      const delta = await call<SyncChangesView>(
        baseUrl,
        'GET',
        `/sync/changes?since=${seqBefore}`,
        { bearer: alice.accessToken },
      );
      expect(delta.body.changes).toEqual([]);

      const activeAfter = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks', {
        bearer: alice.accessToken,
      });
      expect(activeAfter.body.items.map((b) => b.id).sort()).toEqual([bm1.id, bm2.id].sort());
      expect(
        (await call(baseUrl, 'GET', `/bookmarks/${bmTrashed.id}`, { bearer: alice.accessToken }))
          .status,
      ).toBe(200);
      expect(
        (
          await call<Array<unknown>>(baseUrl, 'GET', '/bookmarks/tags', {
            bearer: alice.accessToken,
          })
        ).body,
      ).toEqual([]);
      expect(
        (await call(baseUrl, 'GET', `/collections/${colA.id}`, { bearer: alice.accessToken }))
          .status,
      ).toBe(200);
      expect(
        (
          await call<BookmarkListView>(baseUrl, 'GET', `/bookmarks?collectionId=${colA.id}`, {
            bearer: alice.accessToken,
          })
        ).body.items.map((b) => b.id),
      ).toEqual([bm1.id]);
    });

    it('AC: POST /collections/merge moves children + memberships into target, trashes sources, and refuses descendant merge with 409', async () => {
      await resetAliceData();

      const target = await createCol(alice.accessToken, 'Target');
      const targetChild = await createCol(alice.accessToken, 'Target Existing Child', target.id);
      const source1 = await createCol(alice.accessToken, 'Source 1');
      const s1Child = await createCol(alice.accessToken, 'S1 Child', source1.id);
      const s1Grandchild = await createCol(alice.accessToken, 'S1 Grandchild', s1Child.id);
      const source2 = await createCol(alice.accessToken, 'Source 2');

      const bmTarget = await createBm(alice.accessToken, 'https://merge.example.com/t', 'T');
      const bmShared = await createBm(alice.accessToken, 'https://merge.example.com/s', 'Shared');
      const bmOnlyS2 = await createBm(alice.accessToken, 'https://merge.example.com/s2', 'Only S2');

      await call(baseUrl, 'PUT', `/bookmarks/${bmTarget.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [target.id] },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${bmShared.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [source1.id, source2.id] },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${bmOnlyS2.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [source2.id] },
      });

      // Negative AC: merging source1 into its descendant s1Grandchild -> 409 + full rollback
      const seqBeforeRefusal = (
        await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
      ).body.seq;
      const descendantConflict = await call(baseUrl, 'POST', '/collections/merge', {
        bearer: alice.accessToken,
        body: { sourceIds: [source1.id], targetId: s1Grandchild.id },
      });
      expect(descendantConflict.status).toBe(409);
      expect(problem(descendantConflict).code).toBe('CONFLICT');
      expect(
        (await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken }))
          .body.seq,
      ).toBe(seqBeforeRefusal);

      // Execute merge: [source1, source2] -> target
      const merged = await call<MergeCollectionsResult>(baseUrl, 'POST', '/collections/merge', {
        bearer: alice.accessToken,
        body: { sourceIds: [source1.id, source2.id], targetId: target.id },
      });
      expect(merged.status).toBe(200);
      expect(merged.body.trashedIds).toEqual([source1.id, source2.id]);
      expect(merged.body.movedChildren).toBe(1);
      expect(merged.body.movedBookmarks).toBe(2); // bmShared & bmOnlyS2
      expect(merged.body.target.bookmarkCount).toBe(3);

      // Sources are trashed (404 via GET /collections/:id)
      expect(
        (await call(baseUrl, 'GET', `/collections/${source1.id}`, { bearer: alice.accessToken }))
          .status,
      ).toBe(404);
      expect(
        (await call(baseUrl, 'GET', `/collections/${source2.id}`, { bearer: alice.accessToken }))
          .status,
      ).toBe(404);

      // Tree shows s1Child reparented under target alongside targetChild, with s1Grandchild intact
      const tree = await call<CollectionNodeView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: alice.accessToken,
      });
      expect(tree.status).toBe(200);
      expect(tree.body.map((n) => n.id)).toEqual([target.id]);
      const targetNode = tree.body[0]!;
      expect(targetNode.children.map((c) => c.id)).toEqual([targetChild.id, s1Child.id]);
      expect(targetNode.children[1]!.children.map((c) => c.id)).toEqual([s1Grandchild.id]);

      // All memberships now reside in target
      const targetBookmarks = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${target.id}`,
        { bearer: alice.accessToken },
      );
      expect(targetBookmarks.body.items.map((b) => b.id).sort()).toEqual(
        [bmTarget.id, bmShared.id, bmOnlyS2.id].sort(),
      );
    });

    it('AC: sort-alphabetical & delete-empty verify against /collections/tree (incl. trashed-only subtrees)', async () => {
      await resetAliceData();

      // Out-of-order roots and nested children
      const zebra = await createCol(alice.accessToken, 'Zebra');
      const alpha = await createCol(alice.accessToken, 'alpha');
      const beta = await createCol(alice.accessToken, 'Beta');
      const childDelta = await createCol(alice.accessToken, 'Delta', alpha.id);
      const childCharlie = await createCol(alice.accessToken, 'charlie', alpha.id);
      const childAardvark = await createCol(alice.accessToken, 'aardvark', alpha.id);

      // Sort alphabetical across all levels
      const sorted = await call<{ updated: number }>(
        baseUrl,
        'POST',
        '/collections/sort-alphabetical',
        { bearer: alice.accessToken },
      );
      expect(sorted.status).toBe(200);
      expect(sorted.body.updated).toBeGreaterThan(0);

      const treeAfterSort = await call<CollectionNodeView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: alice.accessToken,
      });
      expect(treeAfterSort.body.map((n) => n.id)).toEqual([alpha.id, beta.id, zebra.id]);
      expect(treeAfterSort.body[0]!.children.map((c) => c.id)).toEqual([
        childAardvark.id,
        childCharlie.id,
        childDelta.id,
      ]);

      // Idempotent repeat call emits 0 updates and 0 sync events
      const seqAfterSort = (
        await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
      ).body.seq;
      const sortedAgain = await call<{ updated: number }>(
        baseUrl,
        'POST',
        '/collections/sort-alphabetical',
        { bearer: alice.accessToken },
      );
      expect(sortedAgain.status).toBe(200);
      expect(sortedAgain.body).toEqual({ updated: 0 });
      expect(
        (await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken }))
          .body.seq,
      ).toBe(seqAfterSort);

      // Build delete-empty fixture:
      // - alpha -> childAardvark (has active bookmark) -> alpha & childAardvark KEPT;
      //   childCharlie & childDelta are empty -> TRASHED.
      // - beta -> holds ONLY a trashed bookmark -> counts as empty -> TRASHED.
      // - zebra -> zebraChild -> zebraGrandchild (all empty) -> ALL 3 TRASHED.
      const zebraChild = await createCol(alice.accessToken, 'Zebra Child', zebra.id);
      const zebraGrandchild = await createCol(alice.accessToken, 'Zebra Grandchild', zebraChild.id);

      const activeBm = await createBm(
        alice.accessToken,
        'https://tree.example.com/active',
        'Active',
      );
      const trashedBm = await createBm(
        alice.accessToken,
        'https://tree.example.com/trashed',
        'Trashed',
      );
      await call(baseUrl, 'PUT', `/bookmarks/${activeBm.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [childAardvark.id] },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${trashedBm.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [beta.id] },
      });
      await call(baseUrl, 'DELETE', `/bookmarks/${trashedBm.id}`, { bearer: alice.accessToken });

      // Total active collections: alpha, childAardvark, childCharlie, childDelta, beta, zebra, zebraChild, zebraGrandchild (8)
      // Kept: alpha, childAardvark (2). Trashed: 6.
      const deletedEmpty = await call<{ trashed: number; kept: number }>(
        baseUrl,
        'POST',
        '/collections/delete-empty',
        { bearer: alice.accessToken },
      );
      expect(deletedEmpty.status).toBe(200);
      expect(deletedEmpty.body).toEqual({ trashed: 6, kept: 2 });

      const treeAfterDeleteEmpty = await call<CollectionNodeView[]>(
        baseUrl,
        'GET',
        '/collections/tree',
        { bearer: alice.accessToken },
      );
      expect(treeAfterDeleteEmpty.body.map((n) => n.id)).toEqual([alpha.id]);
      expect(treeAfterDeleteEmpty.body[0]!.children.map((c) => c.id)).toEqual([childAardvark.id]);
      expect(
        (await call(baseUrl, 'GET', `/collections/${beta.id}`, { bearer: alice.accessToken }))
          .status,
      ).toBe(404);
      expect(
        (
          await call(baseUrl, 'GET', `/collections/${zebraGrandchild.id}`, {
            bearer: alice.accessToken,
          })
        ).status,
      ).toBe(404);

      // Repeat delete-empty returns { trashed: 0, kept: 2 } with 0 sync events
      const seqAfterDeleteEmpty = (
        await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
      ).body.seq;
      const deleteEmptyAgain = await call<{ trashed: number; kept: number }>(
        baseUrl,
        'POST',
        '/collections/delete-empty',
        { bearer: alice.accessToken },
      );
      expect(deleteEmptyAgain.status).toBe(200);
      expect(deleteEmptyAgain.body).toEqual({ trashed: 0, kept: 2 });
      expect(
        (await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken }))
          .body.seq,
      ).toBe(seqAfterDeleteEmpty);
    });

    it('AC: 2nd-device cursor-only sync catches up through mixed bulk ops to identical state', async () => {
      await resetAliceData();

      // Seed initial state before device 2 snapshots its cursor
      const colKeep = await createCol(alice.accessToken, 'Zeta');
      const colSrc = await createCol(alice.accessToken, 'AlphaSrc');
      const colSrcChild = await createCol(alice.accessToken, 'AlphaSrc Child', colSrc.id);
      const colEmpty = await createCol(alice.accessToken, 'Empty Folder');

      const bm1 = await createBm(alice.accessToken, 'https://syncbulk.example.com/1', 'Sync 1');
      const bm2 = await createBm(alice.accessToken, 'https://syncbulk.example.com/2', 'Sync 2');
      const bm3 = await createBm(alice.accessToken, 'https://syncbulk.example.com/3', 'Sync 3');

      await call(baseUrl, 'PUT', `/bookmarks/${bm1.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [colSrc.id] },
      });
      await call(baseUrl, 'POST', `/bookmarks/${bm3.id}/highlights`, {
        bearer: alice.accessToken,
        body: { text: 'Sync cascade highlight' },
      });

      // Device 2 initializes local replica via REST + records cursor
      const initialBookmarks = new Map<string, BookmarkView>();
      const initActive = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?pageSize=100', {
        bearer: aliceDevice2.accessToken,
      });
      for (const b of initActive.body.items) initialBookmarks.set(b.id, b);

      const initialCollections = new Map<string, CollectionView & { deletedAt: string | null }>();
      const initCols = await call<{ items: CollectionView[] }>(baseUrl, 'GET', '/collections', {
        bearer: aliceDevice2.accessToken,
      });
      for (const c of initCols.body.items) {
        initialCollections.set(c.id, { ...c, deletedAt: null });
      }
      const initialTags = new Map<string, TagView>();
      const initialHighlights = new Map<string, HighlightView>();
      const initHl = await call<{ items: HighlightView[] }>(
        baseUrl,
        'GET',
        `/bookmarks/${bm3.id}/highlights`,
        { bearer: aliceDevice2.accessToken },
      );
      for (const h of initHl.body.items) initialHighlights.set(h.id, h);

      let cursor = (
        await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
          bearer: aliceDevice2.accessToken,
        })
      ).body.seq;

      // Device 1 executes a suite of bulk operations
      expect(
        (
          await call(baseUrl, 'POST', '/bookmarks/bulk', {
            bearer: alice.accessToken,
            body: { action: 'addTags', ids: [bm1.id, bm2.id], tags: ['bulk-tag', 'temp-tag'] },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(baseUrl, 'POST', '/bookmarks/bulk', {
            bearer: alice.accessToken,
            body: { action: 'removeTags', ids: [bm1.id, bm2.id], tags: ['temp-tag'] },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(baseUrl, 'POST', '/bookmarks/bulk', {
            bearer: alice.accessToken,
            body: { action: 'move', ids: [bm2.id], collectionIds: [colKeep.id], mode: 'union' },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(baseUrl, 'POST', '/bookmarks/bulk', {
            bearer: alice.accessToken,
            body: { action: 'trash', ids: [bm3.id] },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(baseUrl, 'POST', '/bookmarks/bulk', {
            bearer: alice.accessToken,
            body: { action: 'delete', ids: [bm3.id] },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(baseUrl, 'POST', '/collections/merge', {
            bearer: alice.accessToken,
            body: { sourceIds: [colSrc.id], targetId: colKeep.id },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(baseUrl, 'POST', '/collections/sort-alphabetical', {
            bearer: alice.accessToken,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(baseUrl, 'POST', '/collections/delete-empty', {
            bearer: alice.accessToken,
          })
        ).status,
      ).toBe(200);

      // Device 2 replays ONLY `/sync/changes?since=...` (paginated at limit=5)
      while (true) {
        const page = await call<SyncChangesView>(
          baseUrl,
          'GET',
          `/sync/changes?since=${cursor}&limit=5`,
          { bearer: aliceDevice2.accessToken },
        );
        expect(page.status).toBe(200);
        expect(page.body.resyncRequired).toBe(false);
        cursor = page.body.cursor;

        for (const change of page.body.changes) {
          if (change.entity === 'bookmark') {
            if (change.action === 'delete' || change.snapshot === null) {
              initialBookmarks.delete(change.id);
            } else {
              initialBookmarks.set(change.id, change.snapshot as unknown as BookmarkView);
            }
          } else if (change.entity === 'collection') {
            if (change.action === 'delete' || change.snapshot === null) {
              initialCollections.delete(change.id);
            } else {
              initialCollections.set(
                change.id,
                change.snapshot as unknown as CollectionView & { deletedAt: string | null },
              );
            }
          } else if (change.entity === 'tag') {
            if (change.action === 'delete' || change.snapshot === null) {
              initialTags.delete(change.id);
            } else {
              initialTags.set(change.id, change.snapshot as unknown as TagView);
            }
          } else if (change.entity === 'highlight') {
            if (change.action === 'delete' || change.snapshot === null) {
              initialHighlights.delete(change.id);
            } else {
              initialHighlights.set(change.id, change.snapshot as unknown as HighlightView);
            }
          }
        }
        if (page.body.changes.length < 5) break;
      }

      // Compare Device 2's reconstructed state against authoritative REST endpoints
      const restActive = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?pageSize=100', {
        bearer: alice.accessToken,
      });
      const restActiveMap = new Map(restActive.body.items.map((b) => [b.id, b]));
      expect([...initialBookmarks.keys()].sort()).toEqual([...restActiveMap.keys()].sort());
      for (const [id, bm] of restActiveMap) {
        expect(initialBookmarks.get(id)!.tags.map((t) => t.name)).toEqual(
          bm.tags.map((t) => t.name),
        );
        expect(initialBookmarks.get(id)!.deletedAt).toBeNull();
      }

      // Highlights for hard-deleted bm3 were tombstoned on Device 2
      expect(initialHighlights.size).toBe(0);

      // Tags on Device 2 match active tag catalog (only 'bulk-tag' survives; 'temp-tag' was pruned)
      const restTags = await call<Array<{ id: string; name: string }>>(
        baseUrl,
        'GET',
        '/bookmarks/tags',
        { bearer: alice.accessToken },
      );
      expect([...initialTags.values()].map((t) => t.name)).toEqual(
        restTags.body.map((t) => t.name),
      );

      // Active collections + tree built from Device 2 snapshots match GET /collections/tree
      const activeSyncedCols = [...initialCollections.values()].filter((c) => c.deletedAt === null);
      const syncedTree = buildCollectionTree(
        activeSyncedCols.map((c) => ({
          id: c.id,
          parentId: c.parentId,
          title: c.title,
          icon: c.icon,
          color: c.color,
          order: c.order,
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
        })),
        new Map(),
      );
      const restTree = await call<CollectionNodeView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: alice.accessToken,
      });
      expect(syncedTree.map((n) => n.id)).toEqual(restTree.body.map((n) => n.id));
      expect(syncedTree[0]!.children.map((c) => c.id)).toEqual(
        restTree.body[0]!.children.map((c) => c.id),
      );
      // colSrc (merged -> trashed), colSrcChild (moved under colKeep, empty -> trashed), colEmpty (empty -> trashed)
      expect(initialCollections.get(colSrc.id)!.deletedAt).not.toBeNull();
      expect(initialCollections.get(colSrcChild.id)!.deletedAt).not.toBeNull();
      expect(initialCollections.get(colEmpty.id)!.deletedAt).not.toBeNull();
      expect(activeSyncedCols.map((c) => c.id)).toEqual([colKeep.id]);
    });

    it('MCP parity: bulkBookmarks, mergeCollections, sortCollectionsAlphabetical, deleteEmptyCollections execute via RW PAT and refuse RO PAT', async () => {
      await resetAliceData();

      const col1 = await createCol(alice.accessToken, 'Z-Folder');
      const col2 = await createCol(alice.accessToken, 'A-Folder');
      const colEmpty = await createCol(alice.accessToken, 'Empty-Folder');
      const bm1 = await createBm(alice.accessToken, 'https://mcp-bulk.example.com/1', 'MCP 1');

      const roInit = await mcpPost(baseUrl, aliceRoPat, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'm13-ro', version: '0.0.0' },
        },
      });
      const roSession = roInit.sessionId!;

      for (const toolName of [
        'bulkBookmarks',
        'mergeCollections',
        'sortCollectionsAlphabetical',
        'deleteEmptyCollections',
      ]) {
        const refused = await mcpPost(
          baseUrl,
          aliceRoPat,
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: toolName, arguments: {} },
          },
          roSession,
        );
        expect(refused.message?.result?.['isError']).toBe(true);
      }

      const rwInit = await mcpPost(baseUrl, aliceRwPat, {
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'm13-rw', version: '0.0.0' },
        },
      });
      const rwSession = rwInit.sessionId!;

      const bulkMove = await mcpPost(
        baseUrl,
        aliceRwPat,
        {
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'bulkBookmarks',
            arguments: { action: 'move', ids: [bm1.id], collectionIds: [col1.id], mode: 'union' },
          },
        },
        rwSession,
      );
      expect(bulkMove.message?.error).toBeUndefined();
      expect(bulkMove.message?.result?.['structuredContent']).toEqual({
        action: 'move',
        affected: 1,
        ids: [bm1.id],
      });

      const mergeCall = await mcpPost(
        baseUrl,
        aliceRwPat,
        {
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: {
            name: 'mergeCollections',
            arguments: { sourceIds: [col1.id], targetId: col2.id },
          },
        },
        rwSession,
      );
      expect(mergeCall.message?.error).toBeUndefined();
      const mergePayload = mergeCall.message?.result?.[
        'structuredContent'
      ] as MergeCollectionsResult;
      expect(mergePayload.trashedIds).toEqual([col1.id]);
      expect(mergePayload.target.id).toBe(col2.id);
      expect(mergePayload.movedBookmarks).toBe(1);

      const sortCall = await mcpPost(
        baseUrl,
        aliceRwPat,
        {
          jsonrpc: '2.0',
          id: 13,
          method: 'tools/call',
          params: { name: 'sortCollectionsAlphabetical', arguments: {} },
        },
        rwSession,
      );
      expect(sortCall.message?.error).toBeUndefined();
      expect(
        typeof (sortCall.message?.result?.['structuredContent'] as { updated: number }).updated,
      ).toBe('number');

      const deleteEmptyCall = await mcpPost(
        baseUrl,
        aliceRwPat,
        {
          jsonrpc: '2.0',
          id: 14,
          method: 'tools/call',
          params: { name: 'deleteEmptyCollections', arguments: {} },
        },
        rwSession,
      );
      expect(deleteEmptyCall.message?.error).toBeUndefined();
      expect(deleteEmptyCall.message?.result?.['structuredContent']).toEqual({
        trashed: 1,
        kept: 1,
      });

      expect(
        (await call(baseUrl, 'GET', `/collections/${colEmpty.id}`, { bearer: alice.accessToken }))
          .status,
      ).toBe(404);
    });
  });

  describe('boot B — isolated per-user bulk rate limit (REST + MCP shared bucket)', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let userA: AuthSession;
    let userB: AuthSession;
    let savedBulkLimit: string | undefined;

    beforeAll(async () => {
      savedBulkLimit = process.env['ARCDROP__RATE_LIMIT__BULK_PER_MINUTE'];
      process.env['ARCDROP__RATE_LIMIT__BULK_PER_MINUTE'] = '2';

      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      userA = await createUserViaAdmin(baseUrl, admin, 'bulk-rl-a@arcdrop.test');
      userB = await createUserViaAdmin(baseUrl, admin, 'bulk-rl-b@arcdrop.test');
    }, 60_000);

    afterAll(async () => {
      if (savedBulkLimit === undefined) delete process.env['ARCDROP__RATE_LIMIT__BULK_PER_MINUTE'];
      else process.env['ARCDROP__RATE_LIMIT__BULK_PER_MINUTE'] = savedBulkLimit;

      await new Promise((resolve) => setTimeout(resolve, 60));
      await app?.close();
    });

    it('3rd bulk request trips 429 problem+json over REST and shares quota with MCP without affecting other users', async () => {
      const r1 = await call(baseUrl, 'POST', '/collections/sort-alphabetical', {
        bearer: userA.accessToken,
      });
      const r2 = await call(baseUrl, 'POST', '/collections/delete-empty', {
        bearer: userA.accessToken,
      });
      const r3 = await call(baseUrl, 'POST', '/collections/sort-alphabetical', {
        bearer: userA.accessToken,
      });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(429);
      expect(r3.contentType.startsWith('application/problem+json')).toBe(true);
      expect(problem(r3).code).toBe('TOO_MANY_REQUESTS');

      // Separate user B retains full quota and shares it across REST + MCP
      const b1 = await call(baseUrl, 'POST', '/collections/sort-alphabetical', {
        bearer: userB.accessToken,
      });
      expect(b1.status).toBe(200);

      const patB = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
        bearer: userB.accessToken,
        body: { name: 'User B RW', readOnly: false },
      });
      expect(patB.status).toBe(201);

      const initB = await mcpPost(baseUrl, patB.body.token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'rl-bulk-b', version: '0.0.0' },
        },
      });
      const bSession = initB.sessionId!;

      // 2nd bulk call for userB (via MCP) succeeds
      const b2Mcp = await mcpPost(
        baseUrl,
        patB.body.token,
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'sortCollectionsAlphabetical', arguments: {} },
        },
        bSession,
      );
      expect(b2Mcp.message?.error).toBeUndefined();
      expect(b2Mcp.message?.result?.['isError']).toBeUndefined();

      // 3rd bulk call for userB (via MCP) trips the shared 'bulk' 429 bucket
      const b3Mcp = await mcpPost(
        baseUrl,
        patB.body.token,
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'deleteEmptyCollections', arguments: {} },
        },
        bSession,
      );
      expect(b3Mcp.message?.result?.['isError']).toBe(true);
      const errText =
        (b3Mcp.message?.result?.['content'] as Array<{ text: string }>)[0]?.text ?? '';
      expect(errText).toContain('429');
      expect(errText).toContain('TOO_MANY_REQUESTS');
    });
  });
});
