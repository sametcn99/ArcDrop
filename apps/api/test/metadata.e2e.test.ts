import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { WebSocket as WsClient } from 'ws';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { TrashPurgeService } from '../src/bookmarks/trash-purge.service';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { IconEvictionService } from '../src/metadata/icon-eviction.service';
import { installTestEnv } from './helpers';

/**
 * M6 metadata & icons e2e â€” real HTTP against real Postgres, with the
 * outbound world replaced by LOCAL stub servers (Bun.serve on loopback).
 *
 * The boots run with `ARCDROP__METADATA__ALLOW_PRIVATE=true` (the documented
 * test/dev affordance) so the pipeline may talk to the loopback stubs at all:
 * - **hop 0 relaxed, hops strict** is exactly what makes the
 *   redirect-to-private refusal honestly testable over real HTTP: the stub
 *   "plays" a public host, and its redirect back to a loopback hop is
 *   refused by the always-strict hop validation.
 * - The STRICT boot (allowPrivate=false) proves the plain
 *   private-address refusal at hop 0: with the flag off, even the initial
 *   loopback target is refused and the bookmark keeps its client data.
 *
 * NOTE for future suites: this file sets ARCDROP__METADATA__* env vars for
 * its own boots and RESTORES them in afterAll â€” every other suite relies on
 * installTestEnv's metadata=false default (a live pipeline would scrape
 * real URLs mid-test and inject bookmark:update events that break exact-seq
 * sync assertions).
 */

// -- protocol views -----------------------------------------------------------

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
}

interface UrlPartsView {
  scheme: string;
  host: string;
  domain: string | null;
  port: string | null;
  path: string;
  query: string | null;
  fragment: string | null;
}

interface BookmarkView {
  id: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  favorite: boolean;
  contentType: string;
  coverRef: string | null;
  iconRef: string | null;
  urlParts: UrlPartsView;
  tags: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface BookmarkListView {
  items: BookmarkView[];
  totalCount: number;
}

interface ChangesView {
  resyncRequired: boolean;
  changes: Array<{
    seq: string;
    entity: string;
    id: string;
    action: string;
    snapshot: BookmarkView | null;
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
  headers: Headers;
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
  return { status: res.status, body, contentType, headers: res.headers };
}

const problem = (r: CallResult<unknown>) => r.body as unknown as Problem;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until `probe` returns a non-null result or the deadline passes. */
async function waitFor<T>(timeoutMs: number, probe: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== null) return result;
    await sleep(150);
  }
  throw new Error('condition not met within the deadline');
}

/** Bookmark read that only ever returns REAL rows (never problem bodies). */
async function readBookmark(
  baseUrl: string,
  bearer: string,
  id: string,
): Promise<BookmarkView | null> {
  const res = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${id}`, { bearer });
  return res.status === 200 && typeof res.body.id === 'string' ? res.body : null;
}

// -- stub origin (the "public web", played by a loopback Bun.serve) -----------

const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

const pngResponse = (): Response =>
  new Response(PNG_BYTES.slice().buffer as ArrayBuffer, {
    headers: { 'content-type': 'image/png' },
  });

const stubbedOrigin = (port: number): string => `http://127.0.0.1:${port}`;

/** The stub world; `port` is substituted at serve time. */
function stubRoutes(
  port: number,
  reclassifyToImage: () => boolean,
): Map<string, (url: URL) => Response> {
  const page = (
    title: string,
    ogImage: string | null,
    favicon: string | null,
    description?: string,
    extraMeta?: string,
  ): Response => {
    const meta = [
      `<title>${title}</title>`,
      description ? `<meta name="description" content="${description}">` : '',
      ogImage ? `<meta property="og:image" content="${ogImage}">` : '',
      favicon ? `<link rel="icon" href="${favicon}">` : '',
      extraMeta ?? '',
    ].join('\n');
    return new Response(`<html><head>\n${meta}\n</head><body>stub body</body></html>`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };

  return new Map([
    [
      '/page-good',
      () => page('Stub Good Page', '/icon.png', '/icon.png', 'Stub description for the good page'),
    ],
    [
      '/page-second',
      () => page('Second Page', '/icon2.png', '/icon2.png', 'Second page description'),
    ],
    ['/reindex-page', () => page('Reindex Page', '/icon.png', '/icon.png', 'Reindex description')],
    [
      '/article',
      () =>
        page(
          'Stub Article',
          '/icon.png',
          '/icon.png',
          'Article excerpt',
          '<meta property="og:type" content="article">',
        ),
    ],
    ['/photo.png', pngResponse],
    [
      '/reclassifies',
      () => (reclassifyToImage() ? pngResponse() : page('Initially Link', null, null)),
    ],
    ['/page-badtypes', () => page('BadTypes Page', '/plain', '/plain')],
    ['/icon.png', pngResponse],
    ['/icon2.png', pngResponse],
    [
      '/plain',
      () => new Response('definitely not an image', { headers: { 'content-type': 'text/plain' } }),
    ],
    // Redirects BACK to this origin's loopback address â€” hop â‰¥ 1 is always
    // strictly validated, so this is the real "redirects to a private
    // address" refusal over live HTTP.
    [
      '/redirect-private',
      () =>
        new Response(null, {
          status: 302,
          headers: { location: `${stubbedOrigin(port)}/secret-page` },
        }),
    ],
    ['/secret-page', () => page('Private Leak', null, null, 'metadata that must never land')],
    // ~3 MiB streamed html (no content-length â€” exercises the streamed cap).
    [
      '/huge',
      () => {
        const chunk = new Uint8Array(1024 * 1024).fill(0x61);
        let sent = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= 3) {
              controller.close();
              return;
            }
            sent++;
            controller.enqueue(chunk);
          },
        });
        return new Response(stream, { headers: { 'content-type': 'text/html' } });
      },
    ],
  ]);
}

function startStub(): {
  origin: string;
  setReclassifyImage: (flag: boolean) => void;
  stop: () => void;
} {
  let port = 0; // resolved just after serve() â€” the routes need it for absolute og:image/redirect targets
  let reclassifyImage = false;
  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      const handler = stubRoutes(port, () => reclassifyImage).get(url.pathname);
      return handler ? handler(url) : new Response('not found', { status: 404 });
    },
  });
  const resolvedPort = server.port ?? 0;
  port = resolvedPort;
  return {
    origin: stubbedOrigin(resolvedPort),
    setReclassifyImage: (flag: boolean) => {
      reclassifyImage = flag;
    },
    stop: () => server.stop(true),
  };
}

// -- boot helpers -------------------------------------------------------------

async function bootApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // The metadata boots make hundreds of API calls (polling + many
    // bookmarks); the global 100/min IP bucket would 429 mid-suite. These
    // boots do not test throttling â€” other suites own that â€” so it is
    // neutralized HERE only.
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const config = loadConfig();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(0);
  return { app, baseUrl: await app.getUrl() };
}

async function wipeData(dataSource: DataSource): Promise<void> {
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

interface SyncSocket {
  client: WsClient;
  messages: Array<{ seq: string; entity: string; id: string; action: string }>;
}

function connectSyncWs(baseUrl: string, bearer: string): Promise<SyncSocket> {
  const mint = async (): Promise<string> => {
    const res = await call<{ ticket: string }>(baseUrl, 'POST', '/sync/ticket', { bearer });
    expect(res.status).toBe(201);
    return res.body.ticket;
  };
  return mint().then(
    (ticket) =>
      new Promise<SyncSocket>((resolve, reject) => {
        const client = new WsClient(
          `${baseUrl.replace(/^http/, 'ws')}/api/v1/sync/ws?ticket=${encodeURIComponent(ticket)}`,
        );
        const socket: SyncSocket = { client, messages: [] };
        client.on('message', (data) => {
          try {
            socket.messages.push(JSON.parse(data.toString()));
          } catch {
            // non-JSON frames are not part of the contract
          }
        });
        client.on('error', () => {});
        client.once('open', () => resolve(socket));
        client.once('unexpected-response', (_req, res) =>
          reject(new Error(`handshake rejected with HTTP ${res.statusCode}`)),
        );
      }),
  );
}

async function waitForNotification(
  socket: SyncSocket,
  timeoutMs = 5000,
): Promise<{ seq: string; action: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const next = socket.messages.shift();
    if (next) return next;
    await sleep(20);
  }
  throw new Error('no ws notification arrived within the deadline');
}

const iconPathOf = (ref: string): string =>
  join(process.env.ARCDROP__DATA_DIR ?? '/data', 'icons', ref);

// -- the suite ----------------------------------------------------------------

describe('Metadata & icons (e2e)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  afterAll(async () => {
    // Restore the suite-safe defaults â€” later test files rely on them.
    process.env.ARCDROP__METADATA__ENABLED = 'false';
    process.env.ARCDROP__METADATA__ALLOW_PRIVATE = 'false';
  });

  describe('boot A â€” pipeline on, loopback targets allowed (test affordance)', () => {
    let app: INestApplication;
    let baseUrl: string;
    let admin: AuthSession;
    let alice: AuthSession;
    let device: AuthSession; // second token for the ws listener
    let stub: {
      origin: string;
      setReclassifyImage: (flag: boolean) => void;
      stop: () => void;
    };

    beforeAll(async () => {
      process.env.ARCDROP__METADATA__ENABLED = 'true';
      process.env.ARCDROP__METADATA__ALLOW_PRIVATE = 'true';
      installTestEnv();
      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);

      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      alice = await createUserViaAdmin(baseUrl, admin, 'alice-meta@arcdrop.test');
      device = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: 'alice-meta@arcdrop.test', password: 'user-password-1' },
      }).then((r) => {
        expect(r.status).toBe(201);
        return r.body;
      });
      stub = startStub();
    }, 60_000);

    afterAll(async () => {
      stub?.stop();
      await app?.close();
    });

    it('exposes the new operations with stable ids in the OpenAPI document', async () => {
      const res = await fetch(`${baseUrl}/openapi.json`);
      expect(res.status).toBe(200);
      const served = (await res.json()) as {
        paths: Record<string, Record<string, { operationId?: string }>>;
      };
      expect(served.paths['/api/v1/bookmarks/{id}/reindex']?.post?.operationId).toBe(
        'reindexBookmark',
      );
      expect(served.paths['/api/v1/icons/{id}']?.get?.operationId).toBe('getIcon');
    });

    it('AC: create responds immediately, then metadata + icon refs arrive with a change event', async () => {
      const listener = await connectSyncWs(baseUrl, device.accessToken);

      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/page-good`, title: 'Client Title' },
      });
      expect(created.status).toBe(201);
      const bm = created.body.id;
      // IMMEDIATE: the response carries client data and no refs â€” the
      // pipeline must not have blocked the request.
      expect(created.body.title).toBe('Client Title');
      expect(created.body.excerpt).toBeNull();
      expect(created.body.coverRef).toBeNull();
      expect(created.body.iconRef).toBeNull();
      expect(created.body.contentType).toBe('link');

      // Devices hear create, then the pipeline's completion update.
      const noteCreate = await waitForNotification(listener);
      expect(noteCreate.action).toBe('create');
      const noteUpdate = await waitForNotification(listener);
      expect(noteUpdate.action).toBe('update');
      expect(BigInt(noteUpdate.seq)).toBe(BigInt(noteCreate.seq) + 1n);

      // Shortly after: refs appear, client-provided fields untouched.
      const filled = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, bm);
        return row !== null && row.iconRef !== null ? row : null;
      });
      expect(filled.title).toBe('Client Title'); // never overwritten
      expect(filled.excerpt).toBe('Stub description for the good page'); // filled
      expect(filled.coverRef).toMatch(/\.png$/);
      expect(filled.iconRef).toMatch(/\.png$/);
      expect(filled.coverRef).not.toBe(filled.iconRef); // og:image and favicon stored separately
      expect(filled.contentType).toBe('link');

      // The delta carries both events; the update snapshot IS the row.
      const delta = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=0', {
        bearer: alice.accessToken,
      });
      expect(delta.status).toBe(200);
      expect(delta.body.changes.map((c) => c.action)).toEqual(['create', 'update']);
      const snapshot = delta.body.changes[1]?.snapshot as BookmarkView;
      expect(snapshot.id).toBe(bm);
      expect(snapshot.coverRef).toBe(filled.coverRef);
      expect(snapshot.iconRef).toBe(filled.iconRef);
      expect(snapshot.title).toBe('Client Title');

      listener.client.close(1000, 'done');
    }, 20_000);

    it('AC: content-type detection (article og:type, direct image, YouTube host, unclassified link, type filter, reindex)', async () => {
      // 1. HTML article via og:type="article"
      const articleRes = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/article` },
      });
      expect(articleRes.status).toBe(201);
      expect(articleRes.body.contentType).toBe('link');
      const article = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, articleRes.body.id);
        return row !== null && row.contentType === 'article' ? row : null;
      });
      expect(article.title).toBe('Stub Article');
      expect(article.contentType).toBe('article');

      // 2. Direct image URL (/photo.png serving image/png)
      const imageRes = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/photo.png`, title: 'Direct Photo' },
      });
      expect(imageRes.status).toBe(201);
      const imageRow = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, imageRes.body.id);
        return row !== null && row.contentType === 'image' ? row : null;
      });
      expect(imageRow.contentType).toBe('image');

      // 3. YouTube URL (host pattern â†’ video, either live or offline fallback)
      const videoRes = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'YouTube Video' },
      });
      expect(videoRes.status).toBe(201);
      const videoRow = await waitFor(15_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, videoRes.body.id);
        return row !== null && row.contentType === 'video' ? row : null;
      });
      expect(videoRow.contentType).toBe('video');

      // 4. type= filter returns only matching bookmarks
      const onlyVideos = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?type=video', {
        bearer: alice.accessToken,
      });
      expect(onlyVideos.status).toBe(200);
      expect(onlyVideos.body.items.map((b) => b.id)).toEqual([videoRow.id]);

      const onlyArticles = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?type=article', {
        bearer: alice.accessToken,
      });
      expect(onlyArticles.status).toBe(200);
      expect(onlyArticles.body.items.map((b) => b.id)).toEqual([article.id]);

      const onlyImages = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?type=image', {
        bearer: alice.accessToken,
      });
      expect(onlyImages.status).toBe(200);
      expect(onlyImages.body.items.map((b) => b.id)).toEqual([imageRow.id]);

      // 5. Reindex re-classifies when target response changes
      stub.setReclassifyImage(false);
      const mutRes = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/reclassifies` },
      });
      expect(mutRes.status).toBe(201);
      const initialFilled = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, mutRes.body.id);
        return row !== null && row.title === 'Initially Link' ? row : null;
      });
      expect(initialFilled.contentType).toBe('link');

      stub.setReclassifyImage(true);
      const reindex = await call(baseUrl, 'POST', `/bookmarks/${mutRes.body.id}/reindex`, {
        bearer: alice.accessToken,
      });
      expect(reindex.status).toBe(202);
      const reclassified = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, mutRes.body.id);
        return row !== null && row.contentType === 'image' ? row : null;
      });
      expect(reclassified.contentType).toBe('image');
    }, 25_000);

    it('AC: the icon URL serves bytes publicly with the stored type + immutable caching', async () => {
      const list = await call<{ items: BookmarkView[] }>(baseUrl, 'GET', '/bookmarks', {
        bearer: alice.accessToken,
      });
      const withIcon = list.body.items.find(
        (b) => b.url.startsWith(stub.origin) && b.iconRef !== null,
      )!;

      // No Authorization header at all â€” plain <img> tags (D18).
      const res = await fetch(`${baseUrl}/api/v1/icons/${withIcon.iconRef}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(Buffer.from(bytes).equals(Buffer.from(PNG_BYTES))).toBeTrue();

      // Unknown and malformed refs are 404 problem+json â€” still public.
      const unknown = await call(baseUrl, 'GET', `/icons/${'a'.repeat(32)}.png`);
      expect(unknown.status).toBe(404);
      expect(problem(unknown).code).toBe('NOT_FOUND');
      const malformed = await call(baseUrl, 'GET', '/icons/..%2F..%2Fsecrets.png');
      expect([400, 404]).toContain(malformed.status);
    });

    it('SSRF: a redirect back to a private (loopback) hop is refused â€” bookmark keeps client data', async () => {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/redirect-private`, title: 'Redirect Case' },
      });
      expect(created.status).toBe(201);
      expect(created.body.title).toBe('Redirect Case');

      await sleep(1500); // the pipeline completes in ms when allowed â€” give the refusal time to be the outcome
      const after = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${created.body.id}`, {
        bearer: alice.accessToken,
      });
      expect(after.body.title).toBe('Redirect Case'); // client data intact
      expect(after.body.coverRef).toBeNull();
      expect(after.body.iconRef).toBeNull();

      // â€¦and no completion event was recorded for this bookmark.
      const delta = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=0', {
        bearer: alice.accessToken,
      });
      const events = delta.body.changes.filter((c) => c.id === created.body.id);
      expect(events.map((e) => e.action)).toEqual(['create']);
    });

    it('SSRF: an oversized (~3 MiB) response is refused', async () => {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/huge`, title: 'Huge Case' },
      });
      expect(created.status).toBe(201);

      await sleep(1500);
      const after = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${created.body.id}`, {
        bearer: alice.accessToken,
      });
      expect(after.body.title).toBe('Huge Case');
      expect(after.body.coverRef).toBeNull();
      expect(after.body.iconRef).toBeNull();
    });

    it('content-type gates: html text is fetched, non-image og:image/favicon are refused per-field', async () => {
      // NO client title â€” the title-less create lets the pipeline fill the
      // page's own <title>, proving the html path worked while the image
      // paths refused.
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/page-badtypes` },
      });
      expect(created.status).toBe(201);

      // The page itself IS html â†’ title fills; the og:image/favicon URLs
      // serve text/plain â†’ both icon fetches refuse, independently.
      const filled = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, created.body.id);
        return row !== null && row.title === 'BadTypes Page' ? row : null;
      });
      expect(filled.excerpt).toBeNull();
      expect(filled.coverRef).toBeNull();
      expect(filled.iconRef).toBeNull();
    }, 15_000);

    it('plain-text "pages" are refused entirely (wrong content-type)', async () => {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/plain`, title: 'Plain Case' },
      });
      expect(created.status).toBe(201);

      await sleep(1500);
      const after = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${created.body.id}`, {
        bearer: alice.accessToken,
      });
      expect(after.body.title).toBe('Plain Case');
      expect(after.body.excerpt).toBeNull();
      expect(after.body.coverRef).toBeNull();
      expect(after.body.iconRef).toBeNull();
    });

    it('reindex: re-runs the pipeline, refills cleared fields, refuses trash/unknown', async () => {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/reindex-page` },
      });
      expect(created.status).toBe(201);
      const bm = created.body.id;
      const firstTitle = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, bm);
        return row !== null && row.title !== null ? row : null;
      });
      expect(firstTitle.title).toBe('Reindex Page');

      // Client clears the title; a url-less PUT must NOT trigger the pipeline.
      const cleared = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${bm}`, {
        bearer: alice.accessToken,
        body: { title: null },
      });
      expect(cleared.status).toBe(200);
      expect(cleared.body.title).toBeNull();

      const scheduled = await call<{ id: string; status: string }>(
        baseUrl,
        'POST',
        `/bookmarks/${bm}/reindex`,
        { bearer: alice.accessToken },
      );
      expect(scheduled.status).toBe(202);
      expect(scheduled.body).toEqual({ id: bm, status: 'scheduled' });

      const refilled = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, bm);
        return row !== null && row.title === 'Reindex Page' ? row : null;
      });
      expect(refilled.excerpt).toBe('Reindex description');

      // Unknown id and trashed id are 404s (trash is read-only except restore).
      const unknown = await call(baseUrl, 'POST', `/bookmarks/${crypto.randomUUID()}/reindex`, {
        bearer: alice.accessToken,
      });
      expect(unknown.status).toBe(404);
      await call(baseUrl, 'DELETE', `/bookmarks/${bm}`, { bearer: alice.accessToken });
      const trashed = await call(baseUrl, 'POST', `/bookmarks/${bm}/reindex`, {
        bearer: alice.accessToken,
      });
      expect(trashed.status).toBe(404);
    });

    it('url update re-fetches the server-owned refs for the new page', async () => {
      const list = await call<{ items: BookmarkView[] }>(baseUrl, 'GET', '/bookmarks', {
        bearer: alice.accessToken,
      });
      const bm = list.body.items.find(
        (b) => b.url.endsWith('/page-good') && b.title === 'Client Title',
      )!;

      const updated = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${bm.id}`, {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/page-second` },
      });
      expect(updated.status).toBe(200);

      const refreshed = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, bm.id);
        return row !== null && row.coverRef !== null && row.coverRef !== bm.coverRef ? row : null;
      });
      expect(refreshed.title).toBe('Client Title'); // text is never overwritten
      expect(refreshed.iconRef).not.toBe(bm.iconRef); // both server-owned refs replaced
      // Text fields are fill-if-null â€” the OLD page's description stays
      // (the pipeline cannot tell it apart from client-provided data).
      expect(refreshed.excerpt).toBe('Stub description for the good page');
    }, 15_000);

    it('AC: eviction removes orphaned icons after create â†’ trash â†’ purge', async () => {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/page-good`, title: 'Doomed Bookmark' },
      });
      const doomed = await waitFor(8_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, created.body.id);
        return row !== null && row.iconRef !== null ? row : null;
      });
      expect(existsSync(iconPathOf(doomed.iconRef!))).toBeTrue();
      expect(existsSync(iconPathOf(doomed.coverRef!))).toBeTrue();

      // A fake orphan and a foreign file share the directory.
      const fakeOrphan = `${'z'.repeat(32)}.png`;
      writeFileSync(iconPathOf(fakeOrphan), PNG_BYTES);
      writeFileSync(
        join(process.env.ARCDROP__DATA_DIR ?? '/data', 'icons', 'README.txt'),
        'keep me',
      );

      // trash â†’ (backdated) purge: the rows die, the files orphan.
      const trash = await call(baseUrl, 'DELETE', `/bookmarks/${doomed.id}`, {
        bearer: alice.accessToken,
      });
      expect(trash.status).toBe(204);
      await dataSource.query(
        `UPDATE bookmarks SET deleted_at = NOW() - INTERVAL '400 days' WHERE id = $1`,
        [doomed.id],
      );
      const purge = await app.get(TrashPurgeService).purgeExpired();
      expect(purge.purged).toBeGreaterThanOrEqual(1);

      // The purge ALSO fires the icon-eviction ride-along (fire-and-forget),
      // so this explicit sweep may split the work with it â€” never assert on
      // the COUNT. The file state below is what is deterministic: whichever
      // sweep runs last leaves the same world.
      await app.get(IconEvictionService).evictOrphaned();

      expect(existsSync(iconPathOf(doomed.iconRef!))).toBeFalse();
      expect(existsSync(iconPathOf(doomed.coverRef!))).toBeFalse();
      expect(existsSync(iconPathOf(fakeOrphan))).toBeFalse();
      expect(
        existsSync(join(process.env.ARCDROP__DATA_DIR ?? '/data', 'icons', 'README.txt')),
      ).toBeTrue();

      // Serving reflects the eviction.
      const gone = await call(baseUrl, 'GET', `/icons/${doomed.iconRef}`);
      expect(gone.status).toBe(404);

      // Still-referenced files survive (other bookmarks keep theirs).
      const list = await call<{ items: BookmarkView[] }>(baseUrl, 'GET', '/bookmarks', {
        bearer: alice.accessToken,
      });
      const survivor = list.body.items.find((b) => b.iconRef !== null)!;
      expect(existsSync(iconPathOf(survivor.iconRef!))).toBeTrue();
    });

    it('the backfill script enriches a pre-M6 row inserted directly into the DB', async () => {
      // Simulate a pre-M6 row (no title/excerpt/refs) below the REST surface.
      const inserted = (await dataSource.query(
        `INSERT INTO bookmarks (user_id, url, title, excerpt, note, cover_ref, icon_ref,
           scheme, host, domain, port, path, query, fragment, created_at, updated_at)
         VALUES ($1, $2, NULL, NULL, NULL, NULL, NULL, 'http', '127.0.0.1', NULL, NULL, '/', NULL, NULL, NOW(), NOW())
         RETURNING id`,
        [alice.user.id, `${stub.origin}/page-good`],
      )) as Array<{ id: string }>;
      const id = inserted[0]!.id;

      // The script runs as its own process â€” the container workflow, for real.
      // (`bun --cwd=apps/api test` makes the cwd the app dir; both spellings
      // are tried so the suite works from either invocation directory.)
      const candidates = [
        join(process.cwd(), 'src', 'scripts', 'backfill-metadata.ts'),
        join(process.cwd(), 'apps', 'api', 'src', 'scripts', 'backfill-metadata.ts'),
      ];
      const scriptPath = candidates.find((path) => existsSync(path));
      expect(scriptPath).toBeDefined();
      const proc = Bun.spawn([process.execPath, scriptPath!, '--user=' + alice.user.id], {
        env: {
          ...process.env,
          ARCDROP__METADATA__ENABLED: 'true',
          ARCDROP__METADATA__ALLOW_PRIVATE: 'true',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        const stderr = await new Response(proc.stderr).text();
        const stdout = await new Response(proc.stdout).text();
        throw new Error(
          `backfill script exited ${exitCode} â€” stderr: ${stderr.trim() || '(empty)'} | stdout: ${stdout.trim() || '(empty)'}`,
        );
      }
      expect(exitCode).toBe(0);

      const backfilled = await waitFor(15_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, id);
        return row !== null && row.coverRef !== null ? row : null;
      });
      expect(backfilled.title).toBe('Stub Good Page');
      expect(backfilled.excerpt).toBe('Stub description for the good page');
      expect(backfilled.iconRef).toMatch(/\.png$/);
    }, 30_000);
  });

  describe('boot B â€” strict (allowPrivate=false): loopback targets are refused at hop 0', () => {
    let app: INestApplication;
    let baseUrl: string;
    let alice: AuthSession;
    let stub: { origin: string; stop: () => void };

    beforeAll(async () => {
      process.env.ARCDROP__METADATA__ENABLED = 'true';
      process.env.ARCDROP__METADATA__ALLOW_PRIVATE = 'false';
      installTestEnv();
      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      await wipeData(app.get(DataSource));
      const admin = await bootstrapAdmin(baseUrl);
      alice = await createUserViaAdmin(baseUrl, admin, 'alice-strict@arcdrop.test');
      stub = startStub();
    }, 60_000);

    afterAll(async () => {
      stub?.stop();
      await app?.close();
    });

    it('SSRF: a private (loopback) target is refused outright â€” bookmark still created with client data', async () => {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/page-good`, title: 'Strict Case' },
      });
      expect(created.status).toBe(201);
      expect(created.body.title).toBe('Strict Case');
      expect(created.body.coverRef).toBeNull();
      expect(created.body.iconRef).toBeNull();

      await sleep(1500);
      const after = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${created.body.id}`, {
        bearer: alice.accessToken,
      });
      expect(after.body.title).toBe('Strict Case');
      expect(after.body.coverRef).toBeNull();
      expect(after.body.iconRef).toBeNull();

      // Exactly one event: the create. The refusal recorded no update.
      const delta = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=0', {
        bearer: alice.accessToken,
      });
      expect(delta.body.changes.map((c) => c.action)).toEqual(['create']);
    });
  });
});
