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
import { BrokenLinksService } from '../src/library-health/broken-links.service';
import { installTestEnv } from './helpers';

/**
 * M12 — Library health (e2e): duplicates finder + transactional resolve
 * (plan D13 / D19, parity G10) and scheduled broken-links checker with modes
 * (`off | basic | default | strict`), SSRF-safe probing, `broken:` grammar
 * activation, auto-clear on URL edit / recovery recheck, sync reconstruction,
 * and MCP tool parity.
 */

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
}

interface BookmarkView {
  id: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  note: string | null;
  favorite: boolean;
  contentType: string;
  lastCheckedAt: string | null;
  brokenReason: string | null;
  brokenAt: string | null;
  tags: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface BookmarkListView {
  items: BookmarkView[];
  totalCount: number;
  page: number;
  pageSize: number;
}

interface DuplicateGroupView {
  normalizedUrl: string;
  original: BookmarkView;
  extras: BookmarkView[];
}

interface DuplicateGroupsResponseView {
  groups: DuplicateGroupView[];
}

interface ResolveDuplicatesResponseView {
  kept: BookmarkView;
  trashedIds: string[];
}

interface SyncChangesView {
  resyncRequired: boolean;
  changes: Array<{
    seq: string;
    entity: string;
    id: string;
    action: string;
    snapshot: BookmarkView | Record<string, unknown> | null;
  }>;
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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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

interface StubControl {
  origin: string;
  setRecoverableOk: (ok: boolean) => void;
  hits: Map<string, number>;
  resetHits: () => void;
  stop: () => void;
}

function startStub(): StubControl {
  let port = 0;
  let recoverableOk = false;
  const hits = new Map<string, number>();

  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
      const origin = `http://127.0.0.1:${port}`;

      switch (url.pathname) {
        case '/ok':
          return new Response('ok', { status: 200 });
        case '/404':
          return new Response('not found', { status: 404 });
        case '/410':
          return new Response('gone', { status: 410 });
        case '/500':
          return new Response('server error', { status: 500 });
        case '/head-405':
          return request.method === 'HEAD'
            ? new Response('method not allowed', { status: 405 })
            : new Response('ok via get', { status: 200 });
        case '/head-405-404':
          return request.method === 'HEAD'
            ? new Response('method not allowed', { status: 405 })
            : new Response('missing via get', { status: 404 });
        case '/recoverable':
          return recoverableOk
            ? new Response('recovered', { status: 200 })
            : new Response('temporarily 404', { status: 404 });
        case '/redirect-to-ok':
          return new Response(null, { status: 302, headers: { location: `${origin}/ok` } });
        case '/redirect-no-location':
          return new Response(null, { status: 302 });
        case '/redirect-private':
          return new Response(null, {
            status: 302,
            headers: { location: `${origin}/secret-private` },
          });
        case '/secret-private':
          return new Response('must never be fetched', { status: 200 });
        case '/slow':
          await sleep(1500);
          return new Response('too late', { status: 200 });
        default:
          return new Response('not found', { status: 404 });
      }
    },
  });

  port = server.port ?? 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    setRecoverableOk: (ok: boolean) => {
      recoverableOk = ok;
    },
    hits,
    resetHits: () => hits.clear(),
    stop: () => server.stop(true),
  };
}

describe('Library health M12 (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  afterAll(() => {
    process.env.ARCDROP__METADATA__ENABLED = 'false';
    process.env.ARCDROP__METADATA__ALLOW_PRIVATE = 'false';
  });

  describe('boot A — duplicates, modes, filters, auto-clear, sync, MCP (ALLOW_PRIVATE=true)', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let document: OpenAPIObject;
    let stub: StubControl;
    let admin: AuthSession;
    let alice: AuthSession;
    let bob: AuthSession;
    let aliceRwPat: string;
    let aliceRoPat: string;

    beforeAll(async () => {
      process.env.ARCDROP__METADATA__ENABLED = 'false';
      process.env.ARCDROP__METADATA__ALLOW_PRIVATE = 'true';
      installTestEnv();

      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      document = booted.document;
      dataSource = app.get(DataSource);
      stub = startStub();

      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      alice = await createUserViaAdmin(baseUrl, admin, 'alice-health@arcdrop.test');
      bob = await createUserViaAdmin(baseUrl, admin, 'bob-health@arcdrop.test');

      const rw = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
        bearer: alice.accessToken,
        body: { name: 'Health RW', readOnly: false },
      });
      expect(rw.status).toBe(201);
      aliceRwPat = rw.body.token;

      const ro = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
        bearer: alice.accessToken,
        body: { name: 'Health RO', readOnly: true },
      });
      expect(ro.status).toBe(201);
      aliceRoPat = ro.body.token;
    }, 60_000);

    afterAll(async () => {
      stub?.stop();
      await sleep(100);
      await app?.close();
    });

    it('OpenAPI exposes findDuplicates, resolveDuplicates, broken filter, and updated settings', () => {
      const dupGet = (
        document.paths['/api/v1/library/duplicates'] as { get?: { operationId?: string } }
      )?.get;
      const resolvePost = (
        document.paths['/api/v1/library/duplicates/resolve'] as { post?: { operationId?: string } }
      )?.post;
      expect(dupGet?.operationId).toBe('findDuplicates');
      expect(resolvePost?.operationId).toBe('resolveDuplicates');

      const listOp = (
        document.paths['/api/v1/bookmarks'] as {
          get?: { parameters?: Array<{ name: string; in: string }> };
        }
      )?.get;
      expect(listOp?.parameters?.some((p) => p.name === 'broken' && p.in === 'query')).toBe(true);
    });

    it('AC: duplicates grouping covers every Raindrop normalization rule and excludes distinct/trashed/foreign URLs', async () => {
      const createBm = async (bearer: string, url: string, title: string) => {
        const res = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
          bearer,
          body: { url, title },
        });
        expect(res.status).toBe(201);
        await sleep(5);
        return res.body;
      };

      // Group 1: scheme, www., trailing slashes, default port, tracking params, fragment
      const g1Original = await createBm(
        alice.accessToken,
        'https://www.example.org/docs/guide/?utm_source=x&utm_medium=social#top',
        'Guide Original',
      );
      const g1Extra1 = await createBm(
        alice.accessToken,
        'http://example.org/docs/guide?fbclid=fb123&ref=hn',
        'Guide Extra 1',
      );
      const g1Extra2 = await createBm(
        alice.accessToken,
        'https://example.org:443/docs/guide///?gclid=g1&mc_cid=c1&mc_eid=e1#bottom',
        'Guide Extra 2',
      );

      // Trashed duplicate + Bob's duplicate of Group 1 MUST be excluded
      const trashedCopy = await createBm(
        alice.accessToken,
        'https://example.org/docs/guide',
        'Trashed Duplicate',
      );
      const del = await call(baseUrl, 'DELETE', `/bookmarks/${trashedCopy.id}`, {
        bearer: alice.accessToken,
      });
      expect(del.status).toBe(204);
      await createBm(bob.accessToken, 'https://example.org/docs/guide', 'Bob Duplicate');

      // Group 2: non-tracking query params order normalized + tracking params removed
      const g2Original = await createBm(
        alice.accessToken,
        'https://news.example.org/search?b=2&a=1&utm_campaign=fall',
        'Search Original',
      );
      const g2Extra1 = await createBm(
        alice.accessToken,
        'http://www.news.example.org/search/?a=1&b=2#results',
        'Search Extra 1',
      );

      // Distinct URLs that MUST NOT group with Group 1 or Group 2
      await createBm(alice.accessToken, 'https://docs.example.org/docs/guide', 'Non-www subdomain');
      await createBm(alice.accessToken, 'https://blog.example.org/docs/guide', 'Another subdomain');
      await createBm(alice.accessToken, 'https://example.org/docs/Guide', 'Case-sensitive path');
      await createBm(alice.accessToken, 'https://news.example.org/search?a=1&b=999', 'Other q');

      const res = await call<DuplicateGroupsResponseView>(baseUrl, 'GET', '/library/duplicates', {
        bearer: alice.accessToken,
      });
      expect(res.status).toBe(200);
      const groupsByKey = new Map(res.body.groups.map((g) => [g.normalizedUrl, g]));
      expect([...groupsByKey.keys()].sort()).toEqual([
        'example.org/docs/guide',
        'news.example.org/search?a=1&b=2',
      ]);

      const g1 = groupsByKey.get('example.org/docs/guide')!;
      expect(g1.original.id).toBe(g1Original.id);
      expect(g1.extras.map((e) => e.id)).toEqual([g1Extra1.id, g1Extra2.id]);

      const g2 = groupsByKey.get('news.example.org/search?a=1&b=2')!;
      expect(g2.original.id).toBe(g2Original.id);
      expect(g2.extras.map((e) => e.id)).toEqual([g2Extra1.id]);

      // Bob only has 1 bookmark, so zero duplicate groups for Bob.
      const bobDups = await call<DuplicateGroupsResponseView>(
        baseUrl,
        'GET',
        '/library/duplicates',
        { bearer: bob.accessToken },
      );
      expect(bobDups.status).toBe(200);
      expect(bobDups.body.groups).toEqual([]);
    });

    it('AC: resolve merges tags + collections, trashes extras, validates errors, and sync cursor reconstructs exact state', async () => {
      const dupsBefore = await call<DuplicateGroupsResponseView>(
        baseUrl,
        'GET',
        '/library/duplicates',
        { bearer: alice.accessToken },
      );
      const group1 = dupsBefore.body.groups.find(
        (g) => g.normalizedUrl === 'example.org/docs/guide',
      )!;
      const keepId = group1.original.id;
      const [extra1Id, extra2Id] = group1.extras.map((e) => e.id) as [string, string];

      const colA = (
        await call<{ id: string }>(baseUrl, 'POST', '/collections', {
          bearer: alice.accessToken,
          body: { title: 'Col A' },
        })
      ).body.id;
      const colB = (
        await call<{ id: string }>(baseUrl, 'POST', '/collections', {
          bearer: alice.accessToken,
          body: { title: 'Col B' },
        })
      ).body.id;
      const colC = (
        await call<{ id: string }>(baseUrl, 'POST', '/collections', {
          bearer: alice.accessToken,
          body: { title: 'Col C' },
        })
      ).body.id;

      await call(baseUrl, 'PUT', `/bookmarks/${keepId}/tags`, {
        bearer: alice.accessToken,
        body: { tags: ['keep-tag'] },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${keepId}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [colA] },
      });

      await call(baseUrl, 'PUT', `/bookmarks/${extra1Id}/tags`, {
        bearer: alice.accessToken,
        body: { tags: ['keep-tag', 'extra-tag-1'] },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${extra1Id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [colA, colB] },
      });

      await call(baseUrl, 'PUT', `/bookmarks/${extra2Id}/tags`, {
        bearer: alice.accessToken,
        body: { tags: ['extra-tag-2'] },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${extra2Id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [colC] },
      });

      // Snapshot client state before resolving + record sync cursor.
      const preActive = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?pageSize=100', {
        bearer: alice.accessToken,
      });
      const clientMap = new Map(preActive.body.items.map((b) => [b.id, b]));
      const syncBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
        bearer: alice.accessToken,
      });

      // Validation negative cases
      const selfTrash = await call(baseUrl, 'POST', '/library/duplicates/resolve', {
        bearer: alice.accessToken,
        body: { keepId, trashIds: [keepId, extra1Id] },
      });
      expect(selfTrash.status).toBe(400);
      expect(problem(selfTrash).code).toBe('BAD_REQUEST');

      const foreignRef = await call(baseUrl, 'POST', '/library/duplicates/resolve', {
        bearer: alice.accessToken,
        body: { keepId, trashIds: [crypto.randomUUID()] },
      });
      expect(foreignRef.status).toBe(404);

      // Execute resolve
      const resolved = await call<ResolveDuplicatesResponseView>(
        baseUrl,
        'POST',
        '/library/duplicates/resolve',
        {
          bearer: alice.accessToken,
          body: { keepId, trashIds: [extra1Id, extra2Id] },
        },
      );
      expect(resolved.status).toBe(200);
      expect(resolved.body.kept.id).toBe(keepId);
      expect(resolved.body.kept.tags.map((t) => t.name).sort()).toEqual([
        'extra-tag-1',
        'extra-tag-2',
        'keep-tag',
      ]);
      expect(resolved.body.trashedIds).toEqual([extra1Id, extra2Id]);

      // Group 1 is no longer flagged as duplicate
      const dupsAfter = await call<DuplicateGroupsResponseView>(
        baseUrl,
        'GET',
        '/library/duplicates',
        { bearer: alice.accessToken },
      );
      expect(dupsAfter.body.groups.map((g) => g.normalizedUrl)).toEqual([
        'news.example.org/search?a=1&b=2',
      ]);

      // Keeper is present in Col A, Col B, Col C
      for (const colId of [colA, colB, colC]) {
        const inCol = await call<BookmarkListView>(
          baseUrl,
          'GET',
          `/bookmarks?collectionId=${colId}`,
          { bearer: alice.accessToken },
        );
        expect(inCol.body.items.map((b) => b.id)).toEqual([keepId]);
      }

      // Sync cursor alone reconstructs keeper + trashed extras cleanly
      const changesRes = await call<SyncChangesView>(
        baseUrl,
        'GET',
        `/sync/changes?since=${syncBefore.body.seq}`,
        { bearer: alice.accessToken },
      );
      expect(changesRes.status).toBe(200);
      expect(changesRes.body.resyncRequired).toBe(false);

      for (const change of changesRes.body.changes) {
        if (change.entity === 'bookmark' && change.snapshot) {
          clientMap.set(change.id, change.snapshot as BookmarkView);
        }
      }

      expect(
        clientMap
          .get(keepId)!
          .tags.map((t) => t.name)
          .sort(),
      ).toEqual(['extra-tag-1', 'extra-tag-2', 'keep-tag']);
      expect(clientMap.get(keepId)!.deletedAt).toBeNull();
      expect(clientMap.get(extra1Id)!.deletedAt).not.toBeNull();
      expect(clientMap.get(extra2Id)!.deletedAt).not.toBeNull();
      const collectionUpdates = changesRes.body.changes
        .filter((c) => c.entity === 'collection' && c.action === 'update')
        .map((c) => c.id)
        .sort();
      expect(collectionUpdates).toEqual([colA, colB, colC].sort());
    });

    it('AC: broken-links modes (off, basic, default, strict), filters, broken: grammar, auto-clear, and hop>=1 SSRF', async () => {
      // Wipe bookmarks for a crisp broken-links fixture set
      await dataSource.query('DELETE FROM change_events');
      await dataSource.query('DELETE FROM bookmark_tags');
      await dataSource.query('DELETE FROM bookmark_collections');
      await dataSource.query('DELETE FROM bookmarks');

      const createAlice = async (url: string, title: string) => {
        const res = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
          bearer: alice.accessToken,
          body: { url, title },
        });
        expect(res.status).toBe(201);
        return res.body;
      };
      const getAlice = async (id: string) => {
        const res = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${id}`, {
          bearer: alice.accessToken,
        });
        expect(res.status).toBe(200);
        return res.body;
      };

      const bmOk = await createAlice(`${stub.origin}/ok`, 'Healthy');
      const bm404 = await createAlice(`${stub.origin}/404`, 'Not Found');
      const bm410 = await createAlice(`${stub.origin}/410`, 'Gone');
      const bm500 = await createAlice(`${stub.origin}/500`, 'Server Error');
      const bmHead405 = await createAlice(`${stub.origin}/head-405`, 'HEAD 405 -> GET 200');
      const bmHead405Broken = await createAlice(
        `${stub.origin}/head-405-404`,
        'HEAD 405 -> GET 404',
      );
      const bmDnsDead = await createAlice(
        'https://nonexistent.arcdrop-dead-test.invalid/article',
        'DNS Dead',
      );
      const bmRedirectLoop = await createAlice(
        `${stub.origin}/redirect-no-location`,
        'Redirect Loop',
      );
      const bmTimeout = await createAlice(`${stub.origin}/slow`, 'Slow Timeout');
      const bmRecover = await createAlice(`${stub.origin}/recoverable`, 'Recoverable');
      const bmRedirectPrivate = await createAlice(
        `${stub.origin}/redirect-private`,
        'Redirect Private Hop',
      );

      const sweep = app.get(BrokenLinksService);
      stub.setRecoverableOk(false);
      stub.resetHits();

      // 1. Mode: OFF — never checks
      const setOff = await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { brokenLinkCheckMode: 'off' },
      });
      expect(setOff.status).toBe(200);

      const offSummary = await sweep.sweep({ jitterMinMs: 0, jitterMaxMs: 0, deadlineMs: 120 });
      expect(offSummary).toEqual({
        mode: 'off',
        checked: 0,
        markedBroken: 0,
        cleared: 0,
        skipped: 0,
      });
      expect(stub.hits.size).toBe(0);
      const afterOff404 = await getAlice(bm404.id);
      expect(afterOff404.brokenAt).toBeNull();
      expect(afterOff404.lastCheckedAt).toBeNull();

      // 2. Mode: BASIC — 404/410 only (incl. HEAD 405 -> GET 404 fallback)
      const setBasic = await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { brokenLinkCheckMode: 'basic' },
      });
      expect(setBasic.status).toBe(200);

      const basicSummary = await sweep.sweep({ jitterMinMs: 0, jitterMaxMs: 0, deadlineMs: 120 });
      expect(basicSummary.mode).toBe('basic');
      expect(basicSummary.skipped).toBe(1); // redirect-private hop 1 blocked -> policy-skip

      expect((await getAlice(bmOk.id)).brokenAt).toBeNull();
      expect((await getAlice(bmOk.id)).lastCheckedAt).not.toBeNull();
      expect((await getAlice(bmHead405.id)).brokenAt).toBeNull();
      expect((await getAlice(bm404.id)).brokenReason).toBe('http-404');
      expect((await getAlice(bm404.id)).brokenAt).not.toBeNull();
      expect((await getAlice(bm410.id)).brokenReason).toBe('http-410');
      expect((await getAlice(bmHead405Broken.id)).brokenReason).toBe('http-404');
      expect((await getAlice(bmRecover.id)).brokenReason).toBe('http-404');

      // Non-basic conditions remain unflagged in basic mode
      expect((await getAlice(bm500.id)).brokenAt).toBeNull();
      expect((await getAlice(bmDnsDead.id)).brokenAt).toBeNull();
      expect((await getAlice(bmRedirectLoop.id)).brokenAt).toBeNull();
      expect((await getAlice(bmTimeout.id)).brokenAt).toBeNull();

      // Hop-1 SSRF target was never connected
      expect(stub.hits.get('/secret-private') ?? 0).toBe(0);
      expect((await getAlice(bmRedirectPrivate.id)).brokenAt).toBeNull();
      expect((await getAlice(bmRedirectPrivate.id)).lastCheckedAt).toBeNull();

      // 3. Mode: DEFAULT — +DNS dead domain
      const setDefault = await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { brokenLinkCheckMode: 'default' },
      });
      expect(setDefault.status).toBe(200);

      await sweep.sweep({ jitterMinMs: 0, jitterMaxMs: 0, deadlineMs: 120 });
      const dnsRow = await getAlice(bmDnsDead.id);
      expect(dnsRow.brokenAt).not.toBeNull();
      expect(dnsRow.brokenReason).toBe('dns-resolution-failed');
      // 5xx / timeout / redirect-loop still NOT flagged in default mode
      expect((await getAlice(bm500.id)).brokenAt).toBeNull();
      expect((await getAlice(bmRedirectLoop.id)).brokenAt).toBeNull();
      expect((await getAlice(bmTimeout.id)).brokenAt).toBeNull();

      // 4. Mode: STRICT — +5xx, redirect-loops, timeouts
      const setStrict = await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { brokenLinkCheckMode: 'strict' },
      });
      expect(setStrict.status).toBe(200);

      await sweep.sweep({ jitterMinMs: 0, jitterMaxMs: 0, deadlineMs: 120 });
      expect((await getAlice(bm500.id)).brokenReason).toBe('http-500');
      expect((await getAlice(bmRedirectLoop.id)).brokenReason).toBe('redirect-without-location');
      expect((await getAlice(bmTimeout.id)).brokenReason).toBe('timeout');

      // 5. Filter `broken=true|false` & M11 `broken:` grammar operator
      const expectedBroken = [
        bm404.id,
        bm410.id,
        bmHead405Broken.id,
        bmDnsDead.id,
        bm500.id,
        bmRedirectLoop.id,
        bmTimeout.id,
        bmRecover.id,
      ].sort();
      const expectedHealthy = [bmOk.id, bmHead405.id, bmRedirectPrivate.id].sort();

      const brokenFilter = await call<BookmarkListView>(
        baseUrl,
        'GET',
        '/bookmarks?broken=true&pageSize=50',
        { bearer: alice.accessToken },
      );
      expect(brokenFilter.status).toBe(200);
      expect(brokenFilter.body.items.map((b) => b.id).sort()).toEqual(expectedBroken);

      const healthyFilter = await call<BookmarkListView>(
        baseUrl,
        'GET',
        '/bookmarks?broken=false&pageSize=50',
        { bearer: alice.accessToken },
      );
      expect(healthyFilter.status).toBe(200);
      expect(healthyFilter.body.items.map((b) => b.id).sort()).toEqual(expectedHealthy);

      const brokenGrammar = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?search=${encodeURIComponent('broken:true')}&pageSize=50`,
        { bearer: alice.accessToken },
      );
      expect(brokenGrammar.status).toBe(200);
      expect(brokenGrammar.body.items.map((b) => b.id).sort()).toEqual(expectedBroken);

      const negatedGrammar = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?q=${encodeURIComponent('-broken:true')}&pageSize=50`,
        { bearer: alice.accessToken },
      );
      expect(negatedGrammar.status).toBe(200);
      expect(negatedGrammar.body.items.map((b) => b.id).sort()).toEqual(expectedHealthy);

      // 6a. Auto-clear on URL fix via PUT /bookmarks/:id
      const urlFixed = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${bm404.id}`, {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/ok` },
      });
      expect(urlFixed.status).toBe(200);
      expect(urlFixed.body.brokenAt).toBeNull();
      expect(urlFixed.body.brokenReason).toBeNull();
      expect(urlFixed.body.lastCheckedAt).toBeNull();

      // 6b. Auto-clear on recovery recheck (also change-logged)
      stub.setRecoverableOk(true);
      const cursorBeforeRecovery = (
        await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
      ).body.seq;

      const recoverSweep = await sweep.sweep({
        jitterMinMs: 0,
        jitterMaxMs: 0,
        deadlineMs: 120,
      });
      expect(recoverSweep.cleared).toBe(1);

      const recovered = await getAlice(bmRecover.id);
      expect(recovered.brokenAt).toBeNull();
      expect(recovered.brokenReason).toBeNull();
      expect(recovered.lastCheckedAt).not.toBeNull();

      const fixedAfterSweep = await getAlice(bm404.id);
      expect(fixedAfterSweep.brokenAt).toBeNull();
      expect(fixedAfterSweep.lastCheckedAt).not.toBeNull();

      const recoveryChanges = await call<SyncChangesView>(
        baseUrl,
        'GET',
        `/sync/changes?since=${cursorBeforeRecovery}`,
        { bearer: alice.accessToken },
      );
      expect(
        recoveryChanges.body.changes.some(
          (c) => c.entity === 'bookmark' && c.id === bmRecover.id && c.action === 'update',
        ),
      ).toBe(true);
    }, 30_000);

    it('MCP: findDuplicates, resolveDuplicates (incl. read-only PAT gate), and broken fields on listBookmarks', async () => {
      const a = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: 'https://www.mcp-dup.example.com/item/', title: 'MCP Orig' },
      });
      await sleep(5);
      const b = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: 'https://mcp-dup.example.com/item?utm_source=agent', title: 'MCP Extra' },
      });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);

      // Read-only PAT session
      const roInit = await mcpPost(baseUrl, aliceRoPat, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'm12-ro', version: '0.0.0' },
        },
      });
      expect(roInit.status).toBe(200);
      const roSession = roInit.sessionId!;

      const roFind = await mcpPost(
        baseUrl,
        aliceRoPat,
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'findDuplicates', arguments: {} },
        },
        roSession,
      );
      expect(roFind.message?.error).toBeUndefined();
      const roGroups = (
        roFind.message?.result?.['structuredContent'] as DuplicateGroupsResponseView
      ).groups;
      expect(roGroups.some((g) => g.normalizedUrl === 'mcp-dup.example.com/item')).toBe(true);

      const roResolve = await mcpPost(
        baseUrl,
        aliceRoPat,
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'resolveDuplicates',
            arguments: { keepId: a.body.id, trashIds: [b.body.id] },
          },
        },
        roSession,
      );
      expect(roResolve.message?.result?.['isError']).toBe(true);

      // Read-write PAT session
      const rwInit = await mcpPost(baseUrl, aliceRwPat, {
        jsonrpc: '2.0',
        id: 10,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'm12-rw', version: '0.0.0' },
        },
      });
      expect(rwInit.status).toBe(200);
      const rwSession = rwInit.sessionId!;

      const rwResolve = await mcpPost(
        baseUrl,
        aliceRwPat,
        {
          jsonrpc: '2.0',
          id: 11,
          method: 'tools/call',
          params: {
            name: 'resolveDuplicates',
            arguments: { keepId: a.body.id, trashIds: [b.body.id] },
          },
        },
        rwSession,
      );
      expect(rwResolve.message?.error).toBeUndefined();
      expect(rwResolve.message?.result?.['isError']).toBeUndefined();
      const resolvedPayload = rwResolve.message?.result?.[
        'structuredContent'
      ] as ResolveDuplicatesResponseView;
      expect(resolvedPayload.kept.id).toBe(a.body.id);
      expect(resolvedPayload.trashedIds).toEqual([b.body.id]);

      // Broken fields + broken filter are exposed on listBookmarks
      const brokenViaMcp = await mcpPost(
        baseUrl,
        aliceRoPat,
        {
          jsonrpc: '2.0',
          id: 12,
          method: 'tools/call',
          params: { name: 'listBookmarks', arguments: { broken: true } },
        },
        roSession,
      );
      expect(brokenViaMcp.message?.error).toBeUndefined();
      const mcpBrokenItems = (
        brokenViaMcp.message?.result?.['structuredContent'] as BookmarkListView
      ).items;
      expect(mcpBrokenItems.length).toBeGreaterThanOrEqual(1);
      expect(mcpBrokenItems[0]!.brokenAt).not.toBeNull();
      expect(mcpBrokenItems[0]!.brokenReason).not.toBeNull();
      expect(mcpBrokenItems[0]!.lastCheckedAt).not.toBeNull();
    });
  });

  describe('boot B — strict SSRF (ALLOW_PRIVATE=false): checker never touches private addresses', () => {
    let app: INestApplication;
    let baseUrl: string;
    let stub: StubControl;
    let admin: AuthSession;

    beforeAll(async () => {
      process.env.ARCDROP__METADATA__ENABLED = 'false';
      process.env.ARCDROP__METADATA__ALLOW_PRIVATE = 'false';
      installTestEnv();

      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      stub = startStub();
      await wipeData(app.get(DataSource));
      admin = await bootstrapAdmin(baseUrl);
    }, 60_000);

    afterAll(async () => {
      stub?.stop();
      await sleep(100);
      await app?.close();
    });

    it('SSRF: private loopback URL is skipped without connecting or flagging broken', async () => {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: `${stub.origin}/404`, title: 'Private 404' },
      });
      expect(created.status).toBe(201);

      stub.resetHits();
      const summary = await app.get(BrokenLinksService).sweep({ jitterMinMs: 0, jitterMaxMs: 0 });
      expect(summary.skipped).toBe(1);
      expect(summary.checked).toBe(0);
      expect(summary.markedBroken).toBe(0);
      expect(stub.hits.size).toBe(0);

      const after = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${created.body.id}`, {
        bearer: admin.accessToken,
      });
      expect(after.status).toBe(200);
      expect(after.body.brokenAt).toBeNull();
      expect(after.body.brokenReason).toBeNull();
      expect(after.body.lastCheckedAt).toBeNull();
    });
  });
});
