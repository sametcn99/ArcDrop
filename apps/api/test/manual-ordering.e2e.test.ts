import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { installTestEnv } from './helpers';

/**
 * M16 — Manual ordering (plan D19 / D21, parity G8).
 *
 * Covers every acceptance criterion against real Postgres:
 * - `PATCH /collections/{id}/bookmarks/order` + `GET /bookmarks?sort=manual&collectionId=X`
 * - Membership scoping (D21 proof): same bookmarks in two collections maintain
 *   independent order slots; reordering one never affects the other.
 * - `sort=manual` without `collectionId` -> 400 problem+json with clear detail.
 * - New memberships append `MAX(order) + 1` (across `PUT /bookmarks/{id}/collections`,
 *   quick-add `?collection=`, `POST /bookmarks/bulk` move, `POST /collections/merge`).
 * - Concurrent parallel adds (`Promise.all`) serialize via the M4/M16 seq-lock
 *   trick and never collide on `order` or gap `change_events.seq`.
 * - Pre-migration / `NULL` `order` rows sort `NULLS LAST` under `sort=manual`.
 * - Trash -> restore preserves the bookmark's order slot (and concurrent adds
 *   while trashed append after the preserved slot); purge removes row + slot.
 * - `reorderCollectionBookmarks` emits `bookmark:update` only for changed
 *   memberships without bumping `bookmarks.updatedAt`, and rolls back atomically.
 */

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
}

interface AuthSession {
  user: { id: string; email: string; role: string };
  accessToken: string;
  refreshToken: string;
}

interface BookmarkItem {
  id: string;
  url: string;
  title: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

interface BookmarkListResponse {
  items: BookmarkItem[];
  totalCount: number;
  page: number;
  pageSize: number;
}

interface CallResult<T> {
  status: number;
  body: T;
  contentType: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function call<T = Record<string, unknown>>(
  baseUrl: string,
  method: Method,
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

async function bootApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const config = loadConfig();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(0);
  return { app, baseUrl: await app.getUrl() };
}

async function wipeData(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM notification_outbox');
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

async function createCollection(
  baseUrl: string,
  bearer: string,
  title: string,
): Promise<{ id: string; title: string }> {
  const res = await call<{ id: string; title: string }>(baseUrl, 'POST', '/collections', {
    bearer,
    body: { title },
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function createBookmark(
  baseUrl: string,
  bearer: string,
  url: string,
  title: string,
): Promise<BookmarkItem> {
  const res = await call<BookmarkItem>(baseUrl, 'POST', '/bookmarks', {
    bearer,
    body: { url, title },
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function attachCollections(
  baseUrl: string,
  bearer: string,
  bookmarkId: string,
  collectionIds: string[],
): Promise<void> {
  const res = await call(baseUrl, 'PUT', `/bookmarks/${bookmarkId}/collections`, {
    bearer,
    body: { collectionIds },
  });
  expect(res.status).toBe(200);
}

describe('M16 — Manual ordering (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let admin: AuthSession;
  let alice: AuthSession;
  let bob: AuthSession;

  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();

    const boot = await bootApp();
    app = boot.app;
    baseUrl = boot.baseUrl;
    dataSource = app.get(DataSource);
    await wipeData(dataSource);
    admin = await bootstrapAdmin(baseUrl);
    alice = await createUserViaAdmin(baseUrl, admin, 'alice-m16@arcdrop.test');
    bob = await createUserViaAdmin(baseUrl, admin, 'bob-m16@arcdrop.test');
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('sort=manual without collectionId returns 400 problem+json with clear detail (D21)', async () => {
    const res = await call(baseUrl, 'GET', '/bookmarks?sort=manual', {
      bearer: alice.accessToken,
    });
    expect(res.status).toBe(400);
    expect(res.contentType).toContain('application/problem+json');
    expect(problem(res).code).toBe('BAD_REQUEST');
    expect(problem(res).detail).toContain('collectionId');
  });

  it('D21 membership scoping: reorder collection A without affecting collection B, partial updates, updatedAt preserved, paging works', async () => {
    const colA = await createCollection(baseUrl, alice.accessToken, 'Alpha');
    const colB = await createCollection(baseUrl, alice.accessToken, 'Beta');

    const b1 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/1', 'One');
    const b2 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/2', 'Two');
    const b3 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/3', 'Three');

    // Attach to A in [b1, b2, b3] order, and to B in [b1, b2, b3] order.
    await attachCollections(baseUrl, alice.accessToken, b1.id, [colA.id, colB.id]);
    await attachCollections(baseUrl, alice.accessToken, b2.id, [colA.id, colB.id]);
    await attachCollections(baseUrl, alice.accessToken, b3.id, [colA.id, colB.id]);

    // Default appended slots: 0, 1, 2 in both collections.
    const initialA = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${colA.id}&sort=manual`,
      { bearer: alice.accessToken },
    );
    expect(initialA.status).toBe(200);
    expect(initialA.body.items.map((i) => i.id)).toEqual([b1.id, b2.id, b3.id]);

    const seqBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });

    // Reorder A explicitly to [b3 (0), b1 (1), b2 (2)] -> only A changes, B untouched.
    const patchA = await call(baseUrl, 'PATCH', `/collections/${colA.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: {
        items: [
          { bookmarkId: b3.id, order: 0 },
          { bookmarkId: b1.id, order: 1 },
          { bookmarkId: b2.id, order: 2 },
        ],
      },
    });
    expect(patchA.status).toBe(204);

    // Check A reflects new order; B keeps [b1, b2, b3].
    const listA = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${colA.id}&sort=manual`,
      { bearer: alice.accessToken },
    );
    expect(listA.status).toBe(200);
    expect(listA.body.totalCount).toBe(3);
    expect(listA.body.items.map((i) => i.id)).toEqual([b3.id, b1.id, b2.id]);

    const listB = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${colB.id}&sort=manual`,
      { bearer: alice.accessToken },
    );
    expect(listB.status).toBe(200);
    expect(listB.body.items.map((i) => i.id)).toEqual([b1.id, b2.id, b3.id]);

    // Bookmarks' updatedAt was NOT modified by reordering.
    const fetchedB1 = await call<BookmarkItem>(baseUrl, 'GET', `/bookmarks/${b1.id}`, {
      bearer: alice.accessToken,
    });
    expect(fetchedB1.body.updatedAt).toBe(b1.updatedAt);

    // Change events emitted: 3 bookmark:update events with gapless seqs.
    const changesAfterA = await call<{
      changes: Array<{ seq: string; entity: string; action: string; id: string }>;
    }>(baseUrl, 'GET', `/sync/changes?since=${seqBefore.body.seq}`, {
      bearer: alice.accessToken,
    });
    expect(changesAfterA.body.changes).toHaveLength(3);
    expect(changesAfterA.body.changes.map((c) => [c.entity, c.action, c.id])).toEqual([
      ['bookmark', 'update', b3.id],
      ['bookmark', 'update', b1.id],
      ['bookmark', 'update', b2.id],
    ]);

    // Partial update on B: move only b2 to position 10 (b1 stays 0, b3 stays 2)
    // and re-send b1 with its existing 0 -> only b2 emits a change event!
    const seqBeforePartial = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });
    const partialB = await call(baseUrl, 'PATCH', `/collections/${colB.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: {
        items: [
          { bookmarkId: b1.id, order: 0 },
          { bookmarkId: b2.id, order: 10 },
        ],
      },
    });
    expect(partialB.status).toBe(204);

    const listBAfter = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${colB.id}&sort=manual`,
      { bearer: alice.accessToken },
    );
    expect(listBAfter.body.items.map((i) => i.id)).toEqual([b1.id, b3.id, b2.id]);

    const changesPartial = await call<{
      changes: Array<{ entity: string; action: string; id: string }>;
    }>(baseUrl, 'GET', `/sync/changes?since=${seqBeforePartial.body.seq}`, {
      bearer: alice.accessToken,
    });
    expect(changesPartial.body.changes).toHaveLength(1);
    expect(changesPartial.body.changes[0]).toMatchObject({
      entity: 'bookmark',
      action: 'update',
      id: b2.id,
    });

    // Updating memberships via PUT /bookmarks/{id}/collections preserves b1's order in A,
    // while removing B and adding a third collection C appends at MAX(order)+1 in C.
    const colC = await createCollection(baseUrl, alice.accessToken, 'Gamma');
    await attachCollections(baseUrl, alice.accessToken, b1.id, [colA.id, colC.id]);
    const listAAfterSync = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${colA.id}&sort=manual`,
      { bearer: alice.accessToken },
    );
    expect(listAAfterSync.body.items.map((i) => i.id)).toEqual([b3.id, b1.id, b2.id]);

    // Paging with sort=manual is deterministic across pages and returns exact totalCount.
    const page1 = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${colA.id}&sort=manual&page=1&pageSize=2`,
      { bearer: alice.accessToken },
    );
    const page2 = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${colA.id}&sort=manual&page=2&pageSize=2`,
      { bearer: alice.accessToken },
    );
    expect(page1.body.totalCount).toBe(3);
    expect(page1.body.items.map((i) => i.id)).toEqual([b3.id, b1.id]);
    expect(page2.body.totalCount).toBe(3);
    expect(page2.body.items.map((i) => i.id)).toEqual([b2.id]);
  });

  it('nulls-last ordering: NULL order rows sort after numeric order rows', async () => {
    const col = await createCollection(baseUrl, alice.accessToken, 'Nulls Last');
    const b1 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/n1', 'N1');
    const b2 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/n2', 'N2');
    const b3 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/n3', 'N3');

    await attachCollections(baseUrl, alice.accessToken, b1.id, [col.id]);
    await attachCollections(baseUrl, alice.accessToken, b2.id, [col.id]);
    await attachCollections(baseUrl, alice.accessToken, b3.id, [col.id]);

    // Simulate a pre-migration NULL membership row on b1.
    await dataSource.query(
      `UPDATE bookmark_collections SET "order" = NULL WHERE bookmark_id = $1 AND collection_id = $2`,
      [b1.id, col.id],
    );

    const listed = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${col.id}&sort=manual`,
      { bearer: alice.accessToken },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((i) => i.id)).toEqual([b2.id, b3.id, b1.id]);
  });

  it('append across quick-add, bulk move, and collection merge + parallel concurrent adds never collide', async () => {
    const targetCol = await createCollection(baseUrl, alice.accessToken, 'Concurrent Pool');
    const sourceCol = await createCollection(baseUrl, alice.accessToken, 'Merge Source');

    // Quick-add appends into targetCol (order 0)
    const quickRes = await call<BookmarkItem>(
      baseUrl,
      'POST',
      `/bookmarks?collection=${encodeURIComponent(targetCol.id)}`,
      {
        bearer: alice.accessToken,
        body: { url: 'https://example.com/quick', title: 'Quick' },
      },
    );
    expect(quickRes.status).toBe(201);

    // Create 8 bookmarks and attach them concurrently via Promise.all
    const batch = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        createBookmark(
          baseUrl,
          alice.accessToken,
          `https://example.com/par-${idx}`,
          `Parallel ${idx}`,
        ),
      ),
    );

    const seqBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });
    const seqStart = Number(seqBefore.body.seq);

    const attachResults = await Promise.all(
      batch.map((bm) =>
        call(baseUrl, 'PUT', `/bookmarks/${bm.id}/collections`, {
          bearer: alice.accessToken,
          body: { collectionIds: [targetCol.id] },
        }),
      ),
    );
    for (const r of attachResults) {
      expect(r.status).toBe(200);
    }

    // Also test bulk move (union) and collection merge append after existing orders
    const bulkExtra1 = await createBookmark(
      baseUrl,
      alice.accessToken,
      'https://example.com/bulk1',
      'Bulk 1',
    );
    const bulkExtra2 = await createBookmark(
      baseUrl,
      alice.accessToken,
      'https://example.com/bulk2',
      'Bulk 2',
    );
    const bulkRes = await call(baseUrl, 'POST', '/bookmarks/bulk', {
      bearer: alice.accessToken,
      body: {
        action: 'move',
        ids: [bulkExtra1.id, bulkExtra2.id],
        collectionIds: [targetCol.id],
        mode: 'union',
      },
    });
    expect(bulkRes.status).toBe(200);

    const mergeItem = await createBookmark(
      baseUrl,
      alice.accessToken,
      'https://example.com/merge',
      'Merge Item',
    );
    await attachCollections(baseUrl, alice.accessToken, mergeItem.id, [sourceCol.id]);
    const mergeRes = await call(baseUrl, 'POST', '/collections/merge', {
      bearer: alice.accessToken,
      body: { sourceIds: [sourceCol.id], targetId: targetCol.id },
    });
    expect(mergeRes.status).toBe(200);

    // Verify ALL 12 memberships in targetCol have strictly unique, contiguous orders [0..11]
    const dbRows = (await dataSource.query(
      `SELECT bookmark_id, "order" FROM bookmark_collections
        WHERE collection_id = $1
        ORDER BY "order" ASC`,
      [targetCol.id],
    )) as Array<{ bookmark_id: string; order: number }>;
    expect(dbRows).toHaveLength(12);
    expect(dbRows.map((r) => r.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(dbRows[0]!.bookmark_id).toBe(quickRes.body.id);
    expect(dbRows[9]!.bookmark_id).toBe(bulkExtra1.id);
    expect(dbRows[10]!.bookmark_id).toBe(bulkExtra2.id);
    expect(dbRows[11]!.bookmark_id).toBe(mergeItem.id);

    // Verify change_events seqs are strictly gapless since seqStart
    const seqRows = (await dataSource.query(
      `SELECT seq::int AS seq FROM change_events
        WHERE user_id = $1 AND seq > $2
        ORDER BY seq ASC`,
      [alice.user.id, seqStart],
    )) as Array<{ seq: number }>;
    expect(seqRows.map((r) => r.seq)).toEqual(
      Array.from({ length: seqRows.length }, (_, i) => seqStart + i + 1),
    );
  });

  it('trash -> restore preserves slot (concurrent add appends after preserved slot); purge removes row and slot', async () => {
    const col = await createCollection(baseUrl, alice.accessToken, 'Trash Restore');
    const b1 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/tr1', 'TR 1');
    const b2 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/tr2', 'TR 2');
    const b3 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/tr3', 'TR 3');

    await attachCollections(baseUrl, alice.accessToken, b1.id, [col.id]);
    await attachCollections(baseUrl, alice.accessToken, b2.id, [col.id]);
    await attachCollections(baseUrl, alice.accessToken, b3.id, [col.id]);

    // Explicit slots: b1=10, b2=20, b3=30
    const reorderRes = await call(baseUrl, 'PATCH', `/collections/${col.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: {
        items: [
          { bookmarkId: b1.id, order: 10 },
          { bookmarkId: b2.id, order: 20 },
          { bookmarkId: b3.id, order: 30 },
        ],
      },
    });
    expect(reorderRes.status).toBe(204);

    // Trash b2 (slot 20)
    const trashRes = await call(baseUrl, 'DELETE', `/bookmarks/${b2.id}`, {
      bearer: alice.accessToken,
    });
    expect(trashRes.status).toBe(204);

    // Active manual list omits b2
    const whileTrashed = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${col.id}&sort=manual`,
      { bearer: alice.accessToken },
    );
    expect(whileTrashed.body.items.map((i) => i.id)).toEqual([b1.id, b3.id]);

    // Adding b4 while b2 is trashed appends at 31 (never collides with trashed slot 20)
    const b4 = await createBookmark(baseUrl, alice.accessToken, 'https://example.com/tr4', 'TR 4');
    await attachCollections(baseUrl, alice.accessToken, b4.id, [col.id]);

    // Restore b2 -> returns to slot 20 between b1 (10) and b3 (30)!
    const seqBeforeRestore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });
    const restoreRes = await call<BookmarkItem>(baseUrl, 'POST', `/bookmarks/${b2.id}/restore`, {
      bearer: alice.accessToken,
    });
    expect(restoreRes.status).toBe(200);

    const afterRestore = await call<BookmarkListResponse>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${col.id}&sort=manual`,
      { bearer: alice.accessToken },
    );
    expect(afterRestore.body.items.map((i) => i.id)).toEqual([b1.id, b2.id, b3.id, b4.id]);

    // Restore recorded a bookmark:update change event
    const restoreChanges = await call<{
      changes: Array<{ entity: string; action: string; id: string }>;
    }>(baseUrl, 'GET', `/sync/changes?since=${seqBeforeRestore.body.seq}`, {
      bearer: alice.accessToken,
    });
    expect(restoreChanges.body.changes).toEqual([
      expect.objectContaining({ entity: 'bookmark', action: 'update', id: b2.id }),
    ]);

    // Hard-delete / purge (trash then bulk delete) removes the membership row & slot
    const trashAgain = await call(baseUrl, 'DELETE', `/bookmarks/${b2.id}`, {
      bearer: alice.accessToken,
    });
    expect(trashAgain.status).toBe(204);
    const purgeRes = await call(baseUrl, 'POST', '/bookmarks/bulk', {
      bearer: alice.accessToken,
      body: { action: 'delete', ids: [b2.id] },
    });
    expect(purgeRes.status).toBe(200);

    const membershipAfterPurge = (await dataSource.query(
      `SELECT bookmark_id FROM bookmark_collections WHERE bookmark_id = $1 AND collection_id = $2`,
      [b2.id, col.id],
    )) as Array<{ bookmark_id: string }>;
    expect(membershipAfterPurge).toEqual([]);
  });

  it('rejects duplicate ids, negative orders, non-members, foreign rows, and trashed targets atomically', async () => {
    const col = await createCollection(baseUrl, alice.accessToken, 'Guards');
    const bMember = await createBookmark(
      baseUrl,
      alice.accessToken,
      'https://example.com/g1',
      'Member',
    );
    const bNonMember = await createBookmark(
      baseUrl,
      alice.accessToken,
      'https://example.com/g2',
      'Non-member',
    );
    const bTrashed = await createBookmark(
      baseUrl,
      alice.accessToken,
      'https://example.com/g3',
      'Trashed',
    );
    const bobBm = await createBookmark(baseUrl, bob.accessToken, 'https://example.com/bob', 'Bob');
    const bobCol = await createCollection(baseUrl, bob.accessToken, 'Bob Col');

    await attachCollections(baseUrl, alice.accessToken, bMember.id, [col.id]);
    await attachCollections(baseUrl, alice.accessToken, bTrashed.id, [col.id]);
    await attachCollections(baseUrl, bob.accessToken, bobBm.id, [bobCol.id]);

    const trashBm = await call(baseUrl, 'DELETE', `/bookmarks/${bTrashed.id}`, {
      bearer: alice.accessToken,
    });
    expect(trashBm.status).toBe(204);

    // Duplicate bookmarkId -> 400
    const dup = await call(baseUrl, 'PATCH', `/collections/${col.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: {
        items: [
          { bookmarkId: bMember.id, order: 1 },
          { bookmarkId: bMember.id, order: 2 },
        ],
      },
    });
    expect(dup.status).toBe(400);

    // Negative order -> 400
    const neg = await call(baseUrl, 'PATCH', `/collections/${col.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: { items: [{ bookmarkId: bMember.id, order: -1 }] },
    });
    expect(neg.status).toBe(400);

    // Empty items -> 400
    const empty = await call(baseUrl, 'PATCH', `/collections/${col.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: { items: [] },
    });
    expect(empty.status).toBe(400);

    // Mixed valid member + non-member -> 404, atomic rollback (bMember keeps order 0, zero events)
    const seqBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });
    const nonMember = await call(baseUrl, 'PATCH', `/collections/${col.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: {
        items: [
          { bookmarkId: bMember.id, order: 99 },
          { bookmarkId: bNonMember.id, order: 1 },
        ],
      },
    });
    expect(nonMember.status).toBe(404);

    const rowAfterRollback = (await dataSource.query(
      `SELECT "order" FROM bookmark_collections WHERE bookmark_id = $1 AND collection_id = $2`,
      [bMember.id, col.id],
    )) as Array<{ order: number }>;
    expect(rowAfterRollback[0]!.order).toBe(0);

    const seqAfter = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });
    expect(seqAfter.body.seq).toBe(seqBefore.body.seq);

    // Trashed bookmark -> 404
    const trashedMember = await call(baseUrl, 'PATCH', `/collections/${col.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: { items: [{ bookmarkId: bTrashed.id, order: 1 }] },
    });
    expect(trashedMember.status).toBe(404);

    // Foreign bookmark / foreign collection -> 404 (never 403)
    const foreignBm = await call(baseUrl, 'PATCH', `/collections/${col.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: { items: [{ bookmarkId: bobBm.id, order: 1 }] },
    });
    expect(foreignBm.status).toBe(404);

    const foreignCol = await call(baseUrl, 'PATCH', `/collections/${bobCol.id}/bookmarks/order`, {
      bearer: alice.accessToken,
      body: { items: [{ bookmarkId: bobBm.id, order: 1 }] },
    });
    expect(foreignCol.status).toBe(404);

    // Trashed collection -> 404
    const doomedCol = await createCollection(baseUrl, alice.accessToken, 'Trashed Col');
    await attachCollections(baseUrl, alice.accessToken, bMember.id, [col.id, doomedCol.id]);
    const trashCol = await call(baseUrl, 'DELETE', `/collections/${doomedCol.id}`, {
      bearer: alice.accessToken,
    });
    expect(trashCol.status).toBe(204);

    const onTrashedCol = await call(
      baseUrl,
      'PATCH',
      `/collections/${doomedCol.id}/bookmarks/order`,
      {
        bearer: alice.accessToken,
        body: { items: [{ bookmarkId: bMember.id, order: 5 }] },
      },
    );
    expect(onTrashedCol.status).toBe(404);
  });
});
