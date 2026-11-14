import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { createDataSource } from '../src/database/data-source';
import { loadConfig } from '../src/config/load-config';
import { installTestEnv } from './helpers';

/**
 * M4 collections e2e (plan M4, D4/D5) — real HTTP against real Postgres.
 * Boot A drives the lifecycle: a 3-level tree with counts, membership sync
 * across two collections, the collectionId/unassignedOnly filters, cycle
 * protection, blocked vs cascade delete, the two-phase (trash → hard)
 * delete, restore + root promotion, sibling ordering — and proves every
 * step recorded ChangeEvents with a gapless per-user seq. Boot B is an
 * isolated rate-limit bucket for validation garbage and 404 grids.
 */

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance?: string;
  requestId?: string;
  errors?: Array<{ field: string; messages: string[] }>;
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

interface TreeNodeView extends CollectionView {
  children: TreeNodeView[];
}

interface CollectionListView {
  items: CollectionView[];
}

interface BookmarkView {
  id: string;
  url: string;
  title: string | null;
  deletedAt: string | null;
}

interface BookmarkListView {
  items: BookmarkView[];
  totalCount: number;
  page: number;
  pageSize: number;
}

interface BookmarkCollectionsView {
  collections: Array<{ id: string; title: string }>;
}

interface StatsView {
  total: number;
  unassigned: number;
  trashed: number;
  favorites: number;
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

async function bootApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
  document: OpenAPIObject;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const config = loadConfig();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(0);
  return { app, baseUrl: await app.getUrl(), document };
}

async function wipeData(dataSource: DataSource): Promise<void> {
  // Order respects FKs; CASCADE would cover most of it but be explicit.
  await dataSource.query('DELETE FROM change_events');
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

interface EventRow {
  seq: string;
  entity: string;
  entity_id: string;
  action: string;
}

async function eventsFor(dataSource: DataSource, userId: string): Promise<EventRow[]> {
  return dataSource.query(
    'SELECT seq, entity, entity_id, action FROM change_events WHERE user_id = $1 ORDER BY seq::bigint',
    [userId],
  );
}

const ids = (list: Array<{ id: string }>) => list.map((row) => row.id);

/** Asserts every expected (entity, entityId, action) triple was recorded. */
function expectEvent(events: EventRow[], entity: string, entityId: string, action: string): void {
  const hit = events.some(
    (row) => row.entity === entity && row.entity_id === entityId && row.action === action,
  );
  expect(hit).toBeTrue();
}

describe('Collections (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  describe('boot A — hierarchy, membership, cycle, delete, order, change log', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let bob: AuthSession;
    let document: OpenAPIObject;

    // Structure: A(Work) → A1(Projects) → A1a(Deep)/A1b(Empty); A → A2(Archived); B(Personal).
    let A: string;
    let B: string;
    let A1: string;
    let A2: string;
    let A1a: string;
    let A1b: string;
    let b1: string; // lives in A and A1 (D5 — two collections)
    let b2: string; // lives in A1a
    let b3: string; // lives in B
    let b4: string; // unassigned
    let bobCollection: string;
    let D: string; // hard-deleted in the two-phase test
    let D1: string;
    let F: string; // plain-trashed parent (filter semantics test)

    beforeAll(async () => {
      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      document = booted.document;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      bob = await createUserViaAdmin(baseUrl, admin, 'bob@arcdrop.test');
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('exposes operation ids for every new route (D9)', () => {
      const operationIds = new Set<string>();
      for (const path of Object.values(document.paths ?? {})) {
        for (const op of Object.values(path ?? {})) {
          const operationId = (op as { operationId?: string }).operationId;
          if (operationId) operationIds.add(operationId);
        }
      }
      for (const id of [
        'listCollections',
        'getCollectionTree',
        'createCollection',
        'reorderCollections',
        'getCollection',
        'updateCollection',
        'deleteCollection',
        'restoreCollection',
        'replaceBookmarkCollections',
      ]) {
        expect(operationIds.has(id)).toBeTrue();
      }
    });

    it('creates roots and children, appending to the sibling group', async () => {
      const rootA = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: '  Work  ' },
      });
      expect(rootA.status).toBe(201);
      expect(rootA.body.title).toBe('Work'); // trimmed
      expect(rootA.body.parentId).toBeNull();
      expect(rootA.body.order).toBe(0); // first root
      A = rootA.body.id;

      const rootB = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'Personal' },
      });
      expect(rootB.status).toBe(201);
      expect(rootB.body.order).toBe(1); // appended after Work
      B = rootB.body.id;

      const child = async (title: string, parentId: string): Promise<CollectionView> => {
        const res = await call<CollectionView>(baseUrl, 'POST', '/collections', {
          bearer: admin.accessToken,
          body: { title, parentId },
        });
        expect(res.status).toBe(201);
        return res.body;
      };

      const a1 = await child('Projects', A);
      expect(a1.order).toBe(0); // first child of A
      A1 = a1.id;
      const a2 = await child('Archived', A);
      expect(a2.order).toBe(1);
      A2 = a2.id;
      const a1a = await child('Deep', A1);
      expect(a1a.order).toBe(0);
      A1a = a1a.id;
      const a1b = await child('Empty', A1);
      expect(a1b.order).toBe(1);
      A1b = a1b.id;

      // 3 levels deep (AC): A → A1 → A1a.
      expect(a1a.parentId).toBe(A1);
    });

    it('creates a child only under an existing, active, owned parent', async () => {
      const unknownParent = await call(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'X', parentId: '00000000-0000-4000-8000-000000000001' },
      });
      expect(unknownParent.status).toBe(404);
      expect(unknownParent.contentType).toContain('application/problem+json');
      expect(problem(unknownParent).code).toBe('NOT_FOUND');

      const createBob = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: bob.accessToken,
        body: { title: 'Bob only' },
      });
      expect(createBob.status).toBe(201);
      bobCollection = createBob.body.id;

      const foreignParent = await call(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'X', parentId: bobCollection },
      });
      expect(foreignParent.status).toBe(404); // bob's collection does not exist for admin
    });

    it('syncs a bookmark into TWO collections and counts it in both (D5)', async () => {
      const mk = async (url: string, title: string): Promise<string> => {
        const res = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
          bearer: admin.accessToken,
          body: { url, title },
        });
        expect(res.status).toBe(201);
        return res.body.id;
      };
      b1 = await mk('https://dual.example.com/one', 'Dual member');
      b2 = await mk('https://deep.example.com/two', 'Deep member');
      b3 = await mk('https://pers.example.com/three', 'Personal member');
      b4 = await mk('https://loose.example.com/four', 'Loose member');

      const put = async (
        bookmarkId: string,
        collectionIds: string[],
      ): Promise<BookmarkCollectionsView> => {
        const res = await call<BookmarkCollectionsView>(
          baseUrl,
          'PUT',
          `/bookmarks/${bookmarkId}/collections`,
          { bearer: admin.accessToken, body: { collectionIds } },
        );
        expect(res.status).toBe(200);
        return res.body;
      };

      // One bookmark, two collections (AC: appears under both).
      const dual = await put(b1, [A, A1]);
      expect(ids(dual.collections).sort()).toEqual([A, A1].sort());
      expect(dual.collections.map((c) => c.title).sort()).toEqual(['Projects', 'Work'].sort());

      await put(b2, [A1a]);
      await put(b3, [B]);

      const tree = await call<TreeNodeView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: admin.accessToken,
      });
      expect(tree.status).toBe(200);
      const byId = new Map<string, TreeNodeView>();
      const walk = (nodes: TreeNodeView[]) => {
        for (const node of nodes) {
          byId.set(node.id, node);
          walk(node.children);
        }
      };
      walk(tree.body);
      expect(ids(tree.body)).toEqual([A, B]); // roots in sibling order
      expect(byId.get(A)!.children.map((c) => c.title)).toEqual(['Projects', 'Archived']);
      expect(byId.get(A1)!.children.map((c) => c.title)).toEqual(['Deep', 'Empty']);
      // Direct counts: b1 counted in BOTH A and A1; parents do not add subtrees on.
      expect(byId.get(A)!.bookmarkCount).toBe(1);
      expect(byId.get(A1)!.bookmarkCount).toBe(1);
      expect(byId.get(A1a)!.bookmarkCount).toBe(1);
      expect(byId.get(A1b)!.bookmarkCount).toBe(0);
      expect(byId.get(A2)!.bookmarkCount).toBe(0);
      expect(byId.get(B)!.bookmarkCount).toBe(1);

      const flat = await call<CollectionListView>(baseUrl, 'GET', '/collections', {
        bearer: admin.accessToken,
      });
      expect(flat.status).toBe(200);
      expect(flat.body.items).toHaveLength(6);
      const flatById = new Map(flat.body.items.map((row) => [row.id, row]));
      expect(flatById.get(A1a)!.parentId).toBe(A1); // raw parentId preserved
    });

    it('honors the collectionId and unassignedOnly filters (M3 activation)', async () => {
      const list = async (query: string): Promise<BookmarkListView> => {
        const res = await call<BookmarkListView>(baseUrl, 'GET', `/bookmarks?${query}`, {
          bearer: admin.accessToken,
        });
        expect(res.status).toBe(200);
        return res.body;
      };

      const inA = await list(`collectionId=${A}`);
      expect(inA.totalCount).toBe(1);
      expect(ids(inA.items)).toEqual([b1]);

      const inA1 = await list(`collectionId=${A1}`);
      expect(ids(inA1.items)).toEqual([b1]); // same bookmark, other collection
      const inA1a = await list(`collectionId=${A1a}`);
      expect(ids(inA1a.items)).toEqual([b2]);
      const inB = await list(`collectionId=${B}`);
      expect(ids(inB.items)).toEqual([b3]);

      const unassigned = await list('unassignedOnly=true');
      expect(unassigned.totalCount).toBe(1);
      expect(ids(unassigned.items)).toEqual([b4]);

      // Combined: a member of A is by definition not unassigned.
      const combined = await list(`collectionId=${A}&unassignedOnly=true`);
      expect(combined.totalCount).toBe(0);

      const stats = await call<StatsView>(baseUrl, 'GET', '/bookmarks/stats', {
        bearer: admin.accessToken,
      });
      expect(stats.body).toEqual({ total: 4, unassigned: 1, trashed: 0, favorites: 0 });
    });

    it('removes the bookmark from absent collections on the next sync (exact set)', async () => {
      const put = async (collectionIds: string[]): Promise<BookmarkCollectionsView> => {
        const res = await call<BookmarkCollectionsView>(
          baseUrl,
          'PUT',
          `/bookmarks/${b1}/collections`,
          { bearer: admin.accessToken, body: { collectionIds } },
        );
        expect(res.status).toBe(200);
        return res.body;
      };

      // Shrink to [A1]: disappears from A (AC).
      const shrunk = await put([A1]);
      expect(ids(shrunk.collections)).toEqual([A1]);
      const inA = await call<BookmarkListView>(baseUrl, 'GET', `/bookmarks?collectionId=${A}`, {
        bearer: admin.accessToken,
      });
      expect(inA.body.totalCount).toBe(0);
      const inA1 = await call<BookmarkListView>(baseUrl, 'GET', `/bookmarks?collectionId=${A1}`, {
        bearer: admin.accessToken,
      });
      expect(inA1.body.totalCount).toBe(1);

      // Clear entirely: back to unassigned.
      const cleared = await put([]);
      expect(cleared.collections).toEqual([]);
      const unassigned = await call<BookmarkListView>(
        baseUrl,
        'GET',
        '/bookmarks?unassignedOnly=true',
        { bearer: admin.accessToken },
      );
      expect(unassigned.body.totalCount).toBe(2); // b1 + b4
    });

    it('refuses membership sync with unknown or foreign collections (404)', async () => {
      const unknown = await call(baseUrl, 'PUT', `/bookmarks/${b1}/collections`, {
        bearer: admin.accessToken,
        body: { collectionIds: ['00000000-0000-4000-8000-000000000002'] },
      });
      expect(unknown.status).toBe(404);
      expect(problem(unknown).code).toBe('NOT_FOUND');

      const foreign = await call(baseUrl, 'PUT', `/bookmarks/${b3}/collections`, {
        bearer: admin.accessToken,
        body: { collectionIds: [bobCollection] },
      });
      expect(foreign.status).toBe(404);

      // Isolation: the admin cannot see or mutate bob's collection at all.
      const list = await call<CollectionListView>(baseUrl, 'GET', '/collections', {
        bearer: admin.accessToken,
      });
      expect(list.body.items.map((row) => row.id)).not.toContain(bobCollection);
      const getForeign = await call(baseUrl, 'GET', `/collections/${bobCollection}`, {
        bearer: admin.accessToken,
      });
      expect(getForeign.status).toBe(404);
      const deleteForeign = await call(baseUrl, 'DELETE', `/collections/${bobCollection}`, {
        bearer: admin.accessToken,
      });
      expect(deleteForeign.status).toBe(404);
      const bobFilter = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${bobCollection}`,
        { bearer: admin.accessToken },
      );
      expect(bobFilter.body.totalCount).toBe(0);
    });

    it('refuses membership sync for trashed bookmarks (the trash is read-only)', async () => {
      const trash = await call(baseUrl, 'DELETE', `/bookmarks/${b4}`, {
        bearer: admin.accessToken,
      });
      expect(trash.status).toBe(204);
      const res = await call(baseUrl, 'PUT', `/bookmarks/${b4}/collections`, {
        bearer: admin.accessToken,
        body: { collectionIds: [] },
      });
      expect(res.status).toBe(404);
      expect(problem(res).detail).toContain('active');
    });

    it('fails the cycle moves with 409 problem+json, allows legal re-parents (AC)', async () => {
      const move = async (id: string, parentId: string | null, expectStatus: number) => {
        const res = await call(baseUrl, 'PUT', `/collections/${id}`, {
          bearer: admin.accessToken,
          body: { parentId },
        });
        expect(res.status).toBe(expectStatus);
        return res;
      };

      // Under its own descendant → 409 problem+json (AC).
      const underDescendant = await move(A, A1a, 409);
      expect(underDescendant.contentType).toContain('application/problem+json');
      expect(problem(underDescendant).code).toBe('CONFLICT');
      expect(problem(underDescendant).detail).toContain('ancestor');

      // Under ITSELF → 409.
      await move(A, A, 409);
      // Deeper descendant: A1 under its own child A1b → 409.
      await move(A1, A1b, 409);

      // A legal cross-root move, then back to the root level.
      await move(A, B, 200);
      const tree = await call<TreeNodeView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: admin.accessToken,
      });
      expect(ids(tree.body)).toEqual([B]); // A is now B's only child
      expect(ids(tree.body[0]!.children)).toEqual([A]);
      await move(A, null, 200);
      const restored = await call<TreeNodeView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: admin.accessToken,
      });
      expect(ids(restored.body)).toEqual([A, B]);
    });

    it('updates metadata with PUT semantics (replace / clear)', async () => {
      const res = await call<CollectionView>(baseUrl, 'PUT', `/collections/${A1}`, {
        bearer: admin.accessToken,
        body: { title: 'Projects 2', icon: '📁', color: '#ff0000' },
      });
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Projects 2');
      expect(res.body.icon).toBe('📁');
      expect(res.body.color).toBe('#ff0000');

      const cleared = await call<CollectionView>(baseUrl, 'PUT', `/collections/${A1}`, {
        bearer: admin.accessToken,
        body: { icon: null },
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.icon).toBeNull(); // explicit null clears
      expect(cleared.body.color).toBe('#ff0000'); // absent field stays
      expect(cleared.body.title).toBe('Projects 2');
    });

    it('applies PATCH /collections/order and reflects it in tree AND flat list (AC)', async () => {
      const res = await call(baseUrl, 'PATCH', '/collections/order', {
        bearer: admin.accessToken,
        body: {
          items: [
            { id: A2, order: 0 },
            { id: A1, order: 1 },
          ],
        },
      });
      expect(res.status).toBe(204);

      const tree = await call<TreeNodeView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: admin.accessToken,
      });
      const a = tree.body.find((node) => node.id === A)!;
      expect(a.children.map((c) => c.id)).toEqual([A2, A1]); // swapped by the patch

      const flat = await call<CollectionListView>(baseUrl, 'GET', '/collections', {
        bearer: admin.accessToken,
      });
      const childrenOfA = flat.body.items.filter((row) => row.parentId === A);
      expect(childrenOfA.map((row) => row.id)).toEqual([A2, A1]); // same order in the flat rows

      const unknownId = await call(baseUrl, 'PATCH', '/collections/order', {
        bearer: admin.accessToken,
        body: { items: [{ id: '00000000-0000-4000-8000-000000000003', order: 0 }] },
      });
      expect(unknownId.status).toBe(404);
    });

    // Subtree for the cascade test: C(ToSort) → C1(Inbox), bookmarks b5, b6.
    let C: string;
    let C1: string;
    let b5: string;
    let b6: string;

    it('blocks plain delete with children; ?cascade=trash trashes subtree + bookmarks (AC)', async () => {
      const create = async (title: string, parentId?: string): Promise<string> => {
        const res = await call<CollectionView>(baseUrl, 'POST', '/collections', {
          bearer: admin.accessToken,
          body: parentId ? { title, parentId } : { title },
        });
        expect(res.status).toBe(201);
        return res.body.id;
      };
      C = await create('ToSort');
      C1 = await create('Inbox', C);
      const mk = async (url: string): Promise<string> => {
        const res = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
          bearer: admin.accessToken,
          body: { url },
        });
        expect(res.status).toBe(201);
        return res.body.id;
      };
      b5 = await mk('https://cascade.example.com/five');
      b6 = await mk('https://cascade.example.com/six');
      for (const [bid, cid] of [
        [b5, C],
        [b6, C1],
      ] as const) {
        const res = await call(baseUrl, 'PUT', `/bookmarks/${bid}/collections`, {
          bearer: admin.accessToken,
          body: { collectionIds: [cid] },
        });
        expect(res.status).toBe(200);
      }

      // Blocked while active children exist (AC) — 409 problem+json.
      const blocked = await call(baseUrl, 'DELETE', `/collections/${C}`, {
        bearer: admin.accessToken,
      });
      expect(blocked.status).toBe(409);
      expect(blocked.contentType).toContain('application/problem+json');
      expect(problem(blocked).code).toBe('CONFLICT');

      // ?cascade=trash: trashes C, C1 AND their bookmarks.
      const cascaded = await call(baseUrl, 'DELETE', `/collections/${C}?cascade=trash`, {
        bearer: admin.accessToken,
      });
      expect(cascaded.status).toBe(204);

      const tree = await call<TreeNodeView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: admin.accessToken,
      });
      const all = new Set<string>();
      const walk = (nodes: TreeNodeView[]) => {
        for (const node of nodes) {
          all.add(node.id);
          walk(node.children);
        }
      };
      walk(tree.body);
      expect(all.has(C)).toBeFalse();
      expect(all.has(C1)).toBeFalse();

      const byId = await call(baseUrl, 'GET', `/collections/${C}`, { bearer: admin.accessToken });
      expect(byId.status).toBe(404); // trashed rows are invisible on the read path

      const trashed = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?trashed=true', {
        bearer: admin.accessToken,
      });
      expect(trashed.body.totalCount).toBeGreaterThanOrEqual(2);
      expect(ids(trashed.body.items)).toContain(b5);
      expect(ids(trashed.body.items)).toContain(b6);
      const b5view = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${b5}`, {
        bearer: admin.accessToken,
      });
      expect(b5view.body.deletedAt).not.toBeNull();
    });

    it('restores the subtree pieces individually; trashed parent promotes children (AC)', async () => {
      // The documented restore path: each bookmark via /bookmarks/{id}/restore,
      // each collection via /collections/{id}/restore — restoring a
      // collection does NOT restore its cascade-trashed relatives.
      const restoreBookmark = await call<BookmarkView>(
        baseUrl,
        'POST',
        `/bookmarks/${b5}/restore`,
        {
          bearer: admin.accessToken,
        },
      );
      expect(restoreBookmark.status).toBe(200);
      expect(restoreBookmark.body.deletedAt).toBeNull();

      const restoreChild = await call<CollectionView>(
        baseUrl,
        'POST',
        `/collections/${C1}/restore`,
        {
          bearer: admin.accessToken,
        },
      );
      expect(restoreChild.status).toBe(200);

      // C1's parent C is still trashed → C1 is promoted to the root level.
      const tree = await call<TreeNodeView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: admin.accessToken,
      });
      expect(ids(tree.body)).toContain(C1);
      expect(ids(tree.body)).not.toContain(C);
      const promoted = tree.body.find((node) => node.id === C1)!;
      expect(promoted.parentId).toBe(C); // raw parent link preserved

      // b6 stays in the trash (restore of C1 did not drag it along).
      const trashed = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?trashed=true', {
        bearer: admin.accessToken,
      });
      expect(ids(trashed.body.items)).toContain(b6);

      // Hard delete of the still-trashed C: refused while C1 is ACTIVE —
      // with or without cascade.
      const hardBlocked = await call(baseUrl, 'DELETE', `/collections/${C}`, {
        bearer: admin.accessToken,
      });
      expect(hardBlocked.status).toBe(409);
      const hardBlockedCascade = await call(baseUrl, 'DELETE', `/collections/${C}?cascade=trash`, {
        bearer: admin.accessToken,
      });
      expect(hardBlockedCascade.status).toBe(409);
      expect(problem(hardBlockedCascade).detail).toContain('ACTIVE');
    });

    it('keeps the collectionId filter working for memberships in trashed collections', async () => {
      // F gets plain-deleted (no children): its bookmark stays ACTIVE and
      // the membership row survives — the filter is pure membership (D5).
      const f = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'Trashed parent' },
      });
      expect(f.status).toBe(201);
      F = f.body.id;
      const b8 = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://trashed-parent.example.com/eight' },
      });
      expect(b8.status).toBe(201);
      const put = await call(baseUrl, 'PUT', `/bookmarks/${b8.body.id}/collections`, {
        bearer: admin.accessToken,
        body: { collectionIds: [F] },
      });
      expect(put.status).toBe(200);

      const del = await call(baseUrl, 'DELETE', `/collections/${F}`, { bearer: admin.accessToken });
      expect(del.status).toBe(204); // plain trash, no bookmarks touched

      const filtered = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${F}`,
        { bearer: admin.accessToken },
      );
      expect(filtered.body.totalCount).toBe(1); // membership survives the trash
      expect(ids(filtered.body.items)).toEqual([b8.body.id]);
      const unassigned = await call<BookmarkListView>(
        baseUrl,
        'GET',
        '/bookmarks?unassignedOnly=true',
        { bearer: admin.accessToken },
      );
      expect(ids(unassigned.body.items)).not.toContain(b8.body.id); // still assigned
    });

    it('hard-deletes on the second call with collection tombstones (two-phase delete)', async () => {
      // Subtree D → D1 with bookmark b7 directly in D.
      const d = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'Doomed' },
      });
      D = d.body.id;
      const d1 = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'Doomed child', parentId: D },
      });
      D1 = d1.body.id;
      const b7 = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://doomed.example.com/seven' },
      });
      const put = await call(baseUrl, 'PUT', `/bookmarks/${b7.body.id}/collections`, {
        bearer: admin.accessToken,
        body: { collectionIds: [D] },
      });
      expect(put.status).toBe(200);

      // First call on the leaf D1: trash.
      expect(
        (await call(baseUrl, 'DELETE', `/collections/${D1}`, { bearer: admin.accessToken })).status,
      ).toBe(204);
      // First call on D: allowed now (its only child is already trashed).
      expect(
        (await call(baseUrl, 'DELETE', `/collections/${D}`, { bearer: admin.accessToken })).status,
      ).toBe(204);
      // Second call on D: hard delete, but child ROWS exist → needs cascade.
      const needsCascade = await call(baseUrl, 'DELETE', `/collections/${D}`, {
        bearer: admin.accessToken,
      });
      expect(needsCascade.status).toBe(409);
      // Second call with cascade: hard-deletes D + D1.
      const hard = await call(baseUrl, 'DELETE', `/collections/${D}?cascade=trash`, {
        bearer: admin.accessToken,
      });
      expect(hard.status).toBe(204);

      expect(
        (await call(baseUrl, 'GET', `/collections/${D}`, { bearer: admin.accessToken })).status,
      ).toBe(404);
      expect(
        (await call(baseUrl, 'GET', `/collections/${D1}`, { bearer: admin.accessToken })).status,
      ).toBe(404);

      // The bookmark row SURVIVES the collection hard delete; it just loses
      // its membership (and records a bookmark:update for it).
      const b7view = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${b7.body.id}`, {
        bearer: admin.accessToken,
      });
      expect(b7view.status).toBe(200);
      expect(b7view.body.deletedAt).toBeNull();
      const unassigned = await call<BookmarkListView>(
        baseUrl,
        'GET',
        '/bookmarks?unassignedOnly=true',
        { bearer: admin.accessToken },
      );
      expect(ids(unassigned.body.items)).toContain(b7.body.id); // membership died
    });

    it('recorded every step as ChangeEvents with a gapless per-user seq (AC)', async () => {
      const events = await eventsFor(dataSource, admin.user.id);
      expect(events.length).toBeGreaterThan(0);

      // Gapless: seqs are exactly 1..N (and decimal strings, not numbers).
      for (const [index, row] of events.entries()) {
        expect(typeof row.seq).toBe('string');
        expect(Number(row.seq)).toBe(index + 1);
      }

      // Collection lifecycle vocabulary.
      expectEvent(events, 'collection', A, 'create');
      expectEvent(events, 'collection', A1, 'create');
      expectEvent(events, 'collection', A1, 'update'); // reorder + rename
      expectEvent(events, 'collection', A2, 'update'); // reorder
      expectEvent(events, 'collection', A, 'update'); // moves (to B, back to root)
      expectEvent(events, 'collection', C, 'update'); // cascade trash (soft delete)
      expectEvent(events, 'collection', C1, 'update'); // trash …
      expectEvent(events, 'collection', C1, 'update'); // … and restore
      expectEvent(events, 'collection', F, 'update'); // plain trash

      // Membership changes emit bookmark-level updates (M5 refetches).
      expectEvent(events, 'bookmark', b1, 'update'); // dual add, shrink, clear
      expectEvent(events, 'bookmark', b2, 'update');
      expectEvent(events, 'bookmark', b3, 'update');

      // Cascade trash + membership loss.
      expectEvent(events, 'bookmark', b5, 'update');
      expectEvent(events, 'bookmark', b6, 'update');

      // Trash of a bookmark is a bookmark:update (M3 vocabulary); nothing
      // in this suite hard-deletes a bookmark, so no tombstones exist.
      expect(
        events.some((row) => row.entity === 'bookmark' && row.action === 'delete'),
      ).toBeFalse();

      // Bob's log is separate and gapless too.
      const bobEvents = await eventsFor(dataSource, bob.user.id);
      for (const [index, row] of bobEvents.entries()) {
        expect(Number(row.seq)).toBe(index + 1);
      }
      expectEvent(bobEvents, 'collection', bobCollection, 'create');
    });

    it('emits collection:delete tombstones only for hard-deleted rows', async () => {
      const events = await eventsFor(dataSource, admin.user.id);
      const deletes = events.filter(
        (row) => row.entity === 'collection' && row.action === 'delete',
      );
      // Exactly the two-phase test's hard-deleted rows — C/C1 stay trashed,
      // F is soft-deleted, and no other collection ever died.
      expect(deletes.map((row) => row.entity_id).sort()).toEqual([D, D1].sort());
    });
  });

  describe('boot B — validation grid (isolated rate-limit bucket)', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let someCollection: string;

    beforeAll(async () => {
      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      const res = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'Valid' },
      });
      expect(res.status).toBe(201);
      someCollection = res.body.id;
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('rejects unauthenticated access with problem+json', async () => {
      const res = await call(baseUrl, 'GET', '/collections');
      expect(res.status).toBe(401);
      expect(res.contentType).toContain('application/problem+json');
      expect(problem(res).code).toBe('UNAUTHORIZED');
    });

    it('validates create payloads (400 problem+json with field errors)', async () => {
      const missingTitle = await call(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: {},
      });
      expect(missingTitle.status).toBe(400);
      expect(missingTitle.contentType).toContain('application/problem+json');
      expect(problem(missingTitle).code).toBe('VALIDATION_FAILED');
      expect(problem(missingTitle).errors?.map((e) => e.field)).toContain('title');

      const whitespace = await call(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: '   ' },
      });
      expect(whitespace.status).toBe(400); // empty after trim
      expect(problem(whitespace).code).toBe('BAD_REQUEST');

      const tooLong = await call(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'x'.repeat(256) },
      });
      expect(tooLong.status).toBe(400);

      const badParent = await call(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'X', parentId: 'not-a-uuid' },
      });
      expect(badParent.status).toBe(400);
    });

    it('validates the reorder payload', async () => {
      const empty = await call(baseUrl, 'PATCH', '/collections/order', {
        bearer: admin.accessToken,
        body: { items: [] },
      });
      expect(empty.status).toBe(400);
      expect(problem(empty).code).toBe('VALIDATION_FAILED');

      const badItem = await call(baseUrl, 'PATCH', '/collections/order', {
        bearer: admin.accessToken,
        body: { items: [{ id: 'garbage', order: 0 }] },
      });
      expect(badItem.status).toBe(400);

      const negative = await call(baseUrl, 'PATCH', '/collections/order', {
        bearer: admin.accessToken,
        body: { items: [{ id: someCollection, order: -1 }] },
      });
      expect(negative.status).toBe(400);

      const duplicates = await call(baseUrl, 'PATCH', '/collections/order', {
        bearer: admin.accessToken,
        body: {
          items: [
            { id: someCollection, order: 0 },
            { id: someCollection, order: 1 },
          ],
        },
      });
      expect(duplicates.status).toBe(400);
    });

    it('validates the cascade query param and refuses reordering trashed rows', async () => {
      const badCascade = await call(
        baseUrl,
        'DELETE',
        `/collections/${someCollection}?cascade=bogus`,
        {
          bearer: admin.accessToken,
        },
      );
      expect(badCascade.status).toBe(400);

      // Trash it for real, then try to reorder it.
      const del = await call(baseUrl, 'DELETE', `/collections/${someCollection}`, {
        bearer: admin.accessToken,
      });
      expect(del.status).toBe(204);
      const reorderTrashed = await call(baseUrl, 'PATCH', '/collections/order', {
        bearer: admin.accessToken,
        body: { items: [{ id: someCollection, order: 5 }] },
      });
      expect(reorderTrashed.status).toBe(404);
      expect(problem(reorderTrashed).detail).toContain('active');
    });

    it('cascade=trash on a leaf trashes its direct bookmarks too', async () => {
      const leaf = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'Leaf with content' },
      });
      expect(leaf.status).toBe(201);
      const bookmark = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://leaf-cascade.example.com/one' },
      });
      expect(bookmark.status).toBe(201);
      const put = await call(baseUrl, 'PUT', `/bookmarks/${bookmark.body.id}/collections`, {
        bearer: admin.accessToken,
        body: { collectionIds: [leaf.body.id] },
      });
      expect(put.status).toBe(200);

      const del = await call(baseUrl, 'DELETE', `/collections/${leaf.body.id}?cascade=trash`, {
        bearer: admin.accessToken,
      });
      expect(del.status).toBe(204);

      // The subtree was just the leaf — its bookmark still went to the trash.
      const view = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${bookmark.body.id}`, {
        bearer: admin.accessToken,
      });
      expect(view.body.deletedAt).not.toBeNull();
    });

    it('validates the membership sync payload', async () => {
      const bookmark = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://validate.example.com/one' },
      });
      expect(bookmark.status).toBe(201);

      const notArray = await call(baseUrl, 'PUT', `/bookmarks/${bookmark.body.id}/collections`, {
        bearer: admin.accessToken,
        body: { collectionIds: 'nope' },
      });
      expect(notArray.status).toBe(400);

      const badUuid = await call(baseUrl, 'PUT', `/bookmarks/${bookmark.body.id}/collections`, {
        bearer: admin.accessToken,
        body: { collectionIds: ['garbage'] },
      });
      expect(badUuid.status).toBe(400);
      expect(problem(badUuid).code).toBe('VALIDATION_FAILED');

      const filterGarbage = await call<BookmarkListView>(
        baseUrl,
        'GET',
        '/bookmarks?collectionId=garbage',
        { bearer: admin.accessToken },
      );
      expect(filterGarbage.status).toBe(400); // M3's uuid validation still holds
    });
  });
});
