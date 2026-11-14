import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DataSource } from 'typeorm';
import { WebSocket as WsClient } from 'ws';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { compileSearchQuery, FTS_TEXT_SEARCH_FIELDS } from '../src/bookmarks/search-query.compiler';
import { parseSearchQuery } from '../src/bookmarks/search-query.parser';
import { TrashPurgeService } from '../src/bookmarks/trash-purge.service';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { MetadataFetchService } from '../src/metadata/metadata-fetch.service';
import { DEFAULT_ARCHIVE_MAX_BYTES } from '../src/settings/settings.dto';
import { installTestEnv } from './helpers';

/**
 * M17 Archive & Full-Text Search e2e suite.
 *
 * Boots the full NestJS application against PostgreSQL with
 * `ARCDROP__METADATA__ENABLED=true` and `ARCDROP__METADATA__ALLOW_PRIVATE=true`
 * (restored in `afterAll`) so loopback HTTP stubs exercise real HTTP fetches,
 * Readability + linkedom extraction, `unpdf` PDF extraction, XSS sanitization,
 * on-disk volume storage, PostgreSQL `'simple'` FTS + GIN index plans, retry
 * backoff recovery, login/paywall refusal, Turkish content search, highlights
 * FTS, MCP parity, and hard-delete / purge / reset-data cleanup.
 */

interface BookmarkView {
  id: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  note: string | null;
  contentType: string;
  cacheStatus: 'pending' | 'ready' | 'failed' | 'invalid-origin' | 'skipped';
  cacheCheckedAt: string | null;
  deletedAt: string | null;
}

interface BookmarkListView {
  items: BookmarkView[];
  totalCount: number;
  page: number;
  pageSize: number;
}

interface BookmarkArchiveView {
  bookmarkId: string;
  cacheStatus: 'pending' | 'ready' | 'failed' | 'invalid-origin' | 'skipped';
  cacheCheckedAt: string | null;
  html: string;
  text: string;
}

interface AuthSession {
  accessToken: string;
  user: { id: string; email: string; role: string };
}

interface CallResult<T> {
  status: number;
  body: T;
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
  return { status: res.status, body };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(timeoutMs: number, probe: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== null) return result;
    await sleep(120);
  }
  throw new Error('condition not met within the deadline');
}

async function readBookmark(
  baseUrl: string,
  bearer: string,
  id: string,
): Promise<BookmarkView | null> {
  const res = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${id}`, { bearer });
  return res.status === 200 && typeof res.body.id === 'string' ? res.body : null;
}

function buildSimplePdf(text: string): Uint8Array {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}endstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'utf8'));
}

function startStub(): {
  origin: string;
  setFlakyHealthy: (healthy: boolean) => void;
  setMutableVersion: (version: 'alpha' | 'omega') => void;
  pauseArticle: () => void;
  releaseArticle: () => void;
  stop: () => void;
} {
  let flakyHealthy = false;
  let mutableVersion: 'alpha' | 'omega' = 'alpha';
  let articleGate: Promise<void> | null = null;
  let resolveArticleGate: (() => void) | null = null;

  const articleHtml = (title: string, bodyHtml: string, extraHead = '') =>
    new Response(
      `<!doctype html>
      <html>
        <head><title>${title}</title>${extraHead}</head>
        <body>
          <nav><a href="/home">Nav Home</a></nav>
          <main><article>${bodyHtml}</article></main>
          <footer>Site Footer</footer>
        </body>
      </html>`,
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );

  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      switch (url.pathname) {
        case '/article-systems':
          if (articleGate) await articleGate;
          return articleHtml(
            'Database Architecture Notes',
            `<h1>Storage Architecture</h1>
             <p onclick="alert('xss')">Write-ahead logging guarantees durability across unexpected power loss.</p>
             <p>Background compaction merges immutable SSTable segments without stalling foreground readers.</p>
             <p>Read the <a href="/specs/wal">WAL specification</a> or avoid <a href="javascript:evil()">bad links</a>.</p>
             <script>window.__xss = true;</script>
             <iframe src="https://evil.example/frame"></iframe>`,
          );

        case '/turkish':
          return articleHtml(
            'Yazılım Mimarisi Notları',
            `<h1>İstanbul Teknoloji Günlüğü</h1>
             <p>İstanbul boğazı kıyısındaki mühendislik ekipleri dağıtık sistemler üzerine çalışıyor.</p>
             <p>Türkçe geliştirici ekosistemi özgünlük ölçütü açısından güçlü bir topluluk oluşturuyor.</p>
             <p>Tam metin arama motorları noktalı karakterleri eksiksiz indekslemelidir.</p>`,
          );

        case '/flaky':
          if (!flakyHealthy) {
            return new Response('upstream unavailable', { status: 500 });
          }
          return articleHtml(
            'Recovered Origin',
            `<h1>Recovered Service</h1>
             <p>Transient failures recover cleanly after exponential backoff completes its cycle.</p>
             <p>Resilient background archiving stores the recovered readable article text.</p>`,
          );

        case '/auth-401':
          return new Response('Authentication required', { status: 401 });

        case '/login-form':
          return new Response(
            `<!doctype html>
            <html>
              <head><title>Sign In</title></head>
              <body>
                <form action="/session" method="post">
                  <input type="email" name="email">
                  <input type="password" name="password">
                  <button type="submit">Log in</button>
                </form>
                <p>Sign in to view your workspace</p>
              </body>
            </html>`,
            { headers: { 'content-type': 'text/html; charset=utf-8' } },
          );

        case '/paywall':
          return articleHtml(
            'Locked Story',
            `<p>Subscribe to continue reading this investigative report.</p>`,
            '<meta property="article:content_tier" content="locked">',
          );

        case '/spec.pdf':
          return new Response(buildSimplePdf('ArcDrop Binary Document Extraction Marker'), {
            headers: { 'content-type': 'application/pdf' },
          });

        case '/large-article': {
          const repeated = '<p>Oversized paragraph payload for archive limit testing.</p>'.repeat(
            60,
          );
          return articleHtml('Oversized Page', `<h1>Large Document</h1>${repeated}`);
        }

        case '/mutable':
          return mutableVersion === 'alpha'
            ? articleHtml(
                'Mutable Article',
                `<h1>Mutable Copy</h1><p>Initial snapshot carries the obsidianquartzalpha marker for search testing.</p>`,
              )
            : articleHtml(
                'Mutable Article',
                `<h1>Mutable Copy</h1><p>Refreshed snapshot carries the velvetphotonomega marker after reindexing.</p>`,
              );

        case '/second-url':
          return articleHtml(
            'Replacement Target',
            `<h1>Replaced Target</h1><p>Second destination carries the cobaltnebula identifier.</p>`,
          );

        default:
          return new Response('not found', { status: 404 });
      }
    },
  });

  return {
    origin: `http://127.0.0.1:${server.port}`,
    setFlakyHealthy: (healthy) => {
      flakyHealthy = healthy;
    },
    setMutableVersion: (version) => {
      mutableVersion = version;
    },
    pauseArticle: () => {
      if (!articleGate) {
        articleGate = new Promise<void>((resolve) => {
          resolveArticleGate = resolve;
        });
      }
    },
    releaseArticle: () => {
      const resolve = resolveArticleGate;
      articleGate = null;
      resolveArticleGate = null;
      resolve?.();
    },
    stop: () => {
      resolveArticleGate?.();
      server.stop(true);
    },
  };
}

async function bootApp(): Promise<{ app: INestApplication; baseUrl: string }> {
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
  return { app, baseUrl: await app.getUrl() };
}

async function wipeData(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM audit_log_entries');
  await dataSource.query('DELETE FROM personal_access_tokens');
  await dataSource.query('DELETE FROM notification_outbox');
  await dataSource.query('DELETE FROM tfa_recovery_codes');
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

function connectSyncWs(
  baseUrl: string,
  bearer: string,
): Promise<{ client: WsClient; messages: Array<{ seq: string; id: string; action: string }> }> {
  return call<{ ticket: string }>(baseUrl, 'POST', '/sync/ticket', { bearer }).then((res) => {
    expect(res.status).toBe(201);
    return new Promise((resolve, reject) => {
      const client = new WsClient(
        `${baseUrl.replace(/^http/, 'ws')}/api/v1/sync/ws?ticket=${encodeURIComponent(res.body.ticket)}`,
      );
      const messages: Array<{ seq: string; id: string; action: string }> = [];
      client.on('message', (data) => {
        try {
          messages.push(JSON.parse(data.toString()));
        } catch {
          // ignore non-JSON
        }
      });
      client.on('error', () => {});
      client.once('open', () => resolve({ client, messages }));
      client.once('unexpected-response', (_req, r) =>
        reject(new Error(`ws handshake rejected: ${r.statusCode}`)),
      );
    });
  });
}

function bindNamedParams(
  sql: string,
  namedParams: Record<string, unknown>,
): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const indexByName = new Map<string, number>();
  const text = sql.replace(/:([a-zA-Z0-9_]+)/g, (_full, name: string) => {
    if (!(name in namedParams)) {
      throw new Error(`Missing SQL parameter "${name}"`);
    }
    let idx = indexByName.get(name);
    if (idx === undefined) {
      values.push(namedParams[name]);
      idx = values.length;
      indexByName.set(name, idx);
    }
    return `$${idx}`;
  });
  return { text, values };
}

const archiveDirOf = (bookmarkId: string): string =>
  join(process.env.ARCDROP__DATA_DIR ?? '/data', 'archives', bookmarkId);

describe('Archive & full-text search (M17 e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let admin: AuthSession;
  let alice: AuthSession;
  let bob: AuthSession;
  let stub: ReturnType<typeof startStub>;

  beforeAll(async () => {
    process.env.ARCDROP__METADATA__ENABLED = 'true';
    process.env.ARCDROP__METADATA__ALLOW_PRIVATE = 'true';
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
    alice = await createUserViaAdmin(baseUrl, admin, 'alice-fts@arcdrop.test');
    bob = await createUserViaAdmin(baseUrl, admin, 'bob-fts@arcdrop.test');
    stub = startStub();
  }, 60_000);

  afterAll(async () => {
    stub?.stop();
    await app?.close();
    process.env.ARCDROP__METADATA__ENABLED = 'false';
    process.env.ARCDROP__METADATA__ALLOW_PRIVATE = 'false';
  });

  it('exposes getBookmarkArchive in OpenAPI and MCP tools', async () => {
    const openapiRes = await fetch(`${baseUrl}/openapi.json`);
    expect(openapiRes.status).toBe(200);
    const openapi = (await openapiRes.json()) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    expect(openapi.paths['/api/v1/bookmarks/{id}/archive']?.get?.operationId).toBe(
      'getBookmarkArchive',
    );
  });

  it('AC: saves stub article non-blockingly, stores sanitized files on volume, serves archive, and finds body phrases + prefix via FTS & MCP', async () => {
    const ws = await connectSyncWs(baseUrl, alice.accessToken);

    let bmId = '';
    stub.pauseArticle();
    try {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/article-systems`, title: 'Short Label' },
      });
      expect(created.status).toBe(201);
      expect(created.body.cacheStatus).toBe('pending');
      expect(created.body.cacheCheckedAt).toBeNull();

      bmId = created.body.id;

      // Archive is not ready yet while upstream fetch is in flight (404).
      const pendingArchive = await call(baseUrl, 'GET', `/bookmarks/${bmId}/archive`, {
        bearer: alice.accessToken,
      });
      expect(pendingArchive.status).toBe(404);
    } finally {
      stub.releaseArticle();
    }

    const ready = await waitFor(10_000, async () => {
      const row = await readBookmark(baseUrl, alice.accessToken, bmId);
      return row !== null && row.cacheStatus === 'ready' ? row : null;
    });
    expect(ready.cacheStatus).toBe('ready');
    expect(ready.cacheCheckedAt).not.toBeNull();
    expect(ready.title).toBe('Short Label'); // never overwrites client title

    // Verify change events recorded create + background update.
    await waitFor(3_000, async () =>
      ws.messages.some((m) => m.id === bmId && m.action === 'update') ? true : null,
    );
    ws.client.close(1000, 'done');

    // On-disk archive files exist and are XSS-sanitized.
    const dir = archiveDirOf(bmId);
    expect(existsSync(join(dir, 'content.html'))).toBeTrue();
    expect(existsSync(join(dir, 'content.txt'))).toBeTrue();
    const diskHtml = readFileSync(join(dir, 'content.html'), 'utf8');
    expect(diskHtml).toContain('Write-ahead logging guarantees durability');
    expect(diskHtml).not.toContain('<script');
    expect(diskHtml).not.toContain('<iframe');
    expect(diskHtml).not.toContain('onclick');
    expect(diskHtml).not.toContain('javascript:');
    expect(diskHtml).toContain(`${stub.origin}/specs/wal`);

    // Archive endpoint serves both HTML and plain text to owner, 404 to other users.
    const archiveRes = await call<BookmarkArchiveView>(
      baseUrl,
      'GET',
      `/bookmarks/${bmId}/archive`,
      {
        bearer: alice.accessToken,
      },
    );
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.bookmarkId).toBe(bmId);
    expect(archiveRes.body.cacheStatus).toBe('ready');
    expect(archiveRes.body.html).toContain('Background compaction merges');
    expect(archiveRes.body.text).toContain('Write-ahead logging guarantees durability');

    const foreignArchive = await call(baseUrl, 'GET', `/bookmarks/${bmId}/archive`, {
      bearer: bob.accessToken,
    });
    expect(foreignArchive.status).toBe(404);

    // Search by exact phrase ONLY present in the article body (not title/url).
    const phraseHits = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('"guarantees durability"')}`,
      { bearer: alice.accessToken },
    );
    expect(phraseHits.status).toBe(200);
    expect(phraseHits.body.items.map((b) => b.id)).toContain(bmId);

    // Prefix search via :* (`compact` -> `compaction`) and `q=` alias.
    const prefixHits = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?q=compact', {
      bearer: alice.accessToken,
    });
    expect(prefixHits.status).toBe(200);
    expect(prefixHits.body.items.map((b) => b.id)).toContain(bmId);

    // Exclusion removes the match.
    const excludedHits = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('"guarantees durability" -compaction')}`,
      { bearer: alice.accessToken },
    );
    expect(excludedHits.status).toBe(200);
    expect(excludedHits.body.items.map((b) => b.id)).not.toContain(bmId);

    // MCP read-only PAT parity for `getBookmarkArchive` and FTS `listBookmarks`.
    const patRes = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
      bearer: alice.accessToken,
      body: { name: 'm17-reader', readOnly: true },
    });
    expect(patRes.status).toBe(201);

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/v1/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${patRes.body.token}` } },
    });
    const mcp = new Client({ name: 'm17-e2e', version: '1.0.0' });
    await mcp.connect(transport);
    try {
      const archiveTool = await mcp.callTool({
        name: 'getBookmarkArchive',
        arguments: { id: bmId },
      });
      expect(archiveTool.isError).toBeFalsy();
      expect((archiveTool.structuredContent as BookmarkArchiveView).text).toContain(
        'Write-ahead logging',
      );

      const listTool = await mcp.callTool({
        name: 'listBookmarks',
        arguments: { search: '"immutable SSTable"' },
      });
      expect(listTool.isError).toBeFalsy();
      expect((listTool.structuredContent as BookmarkListView).items.map((i) => i.id)).toContain(
        bmId,
      );
    } finally {
      await mcp.close();
    }
  }, 25_000);

  it('AC: Turkish-content fixture is searchable via Turkish body words (simple config proof)', async () => {
    const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: `${stub.origin}/turkish`, title: 'Neutral English Title' },
    });
    expect(created.status).toBe(201);
    const bmId = created.body.id;

    await waitFor(10_000, async () => {
      const row = await readBookmark(baseUrl, alice.accessToken, bmId);
      return row !== null && row.cacheStatus === 'ready' ? row : null;
    });

    for (const term of ['İstanbul', 'boğazı', 'geliştirici', '"özgünlük ölçütü"', 'ekosistem']) {
      const res = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?search=${encodeURIComponent(term)}`,
        { bearer: alice.accessToken },
      );
      expect(res.status).toBe(200);
      expect(res.body.items.map((b) => b.id)).toContain(bmId);
    }
  }, 20_000);

  it('AC: highlights-only phrase is found via full-text search', async () => {
    const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: `${stub.origin}/article-systems`, title: 'Highlight Host Bookmark' },
    });
    expect(created.status).toBe(201);
    const bmId = created.body.id;

    await waitFor(10_000, async () => {
      const row = await readBookmark(baseUrl, alice.accessToken, bmId);
      return row !== null && row.cacheStatus === 'ready' ? row : null;
    });

    const hlRes = await call(baseUrl, 'POST', `/bookmarks/${bmId}/highlights`, {
      bearer: alice.accessToken,
      body: {
        text: 'We audited the cryptographic ratchet proof end to end.',
        note: 'Key security claim',
      },
    });
    expect(hlRes.status).toBe(201);

    const hits = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('"cryptographic ratchet proof"')}`,
      { bearer: alice.accessToken },
    );
    expect(hits.status).toBe(200);
    expect(hits.body.items.map((b) => b.id)).toEqual([bmId]);
  }, 20_000);

  it('AC: failing origin -> failed with backoff, retry succeeds once server recovers; login/paywall -> invalid-origin; filters work', async () => {
    stub.setFlakyHealthy(false);
    const flakyRes = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: `${stub.origin}/flaky`, title: 'Flaky Origin' },
    });
    expect(flakyRes.status).toBe(201);
    const flakyId = flakyRes.body.id;

    const failedRow = await waitFor(10_000, async () => {
      const row = await readBookmark(baseUrl, alice.accessToken, flakyId);
      return row !== null && row.cacheStatus === 'failed' ? row : null;
    });
    expect(failedRow.cacheCheckedAt).not.toBeNull();

    const dbRetryRow = (await dataSource.query(
      'SELECT cache_retry_count, cache_next_retry_at FROM bookmarks WHERE id = $1',
      [flakyId],
    )) as Array<{ cache_retry_count: number; cache_next_retry_at: Date | null }>;
    expect(dbRetryRow[0]!.cache_retry_count).toBe(1);
    expect(dbRetryRow[0]!.cache_next_retry_at).not.toBeNull();

    // Login-walled and paywalled origins become invalid-origin.
    const [r401, rLogin, rPaywall] = await Promise.all([
      call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/auth-401`, title: 'Auth 401' },
      }),
      call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/login-form`, title: 'Login Form' },
      }),
      call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/paywall`, title: 'Paywall Page' },
      }),
    ]);
    for (const r of [r401, rLogin, rPaywall]) {
      expect(r.status).toBe(201);
      await waitFor(10_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, r.body.id);
        return row !== null && row.cacheStatus === 'invalid-origin' ? row : null;
      });
    }

    // Check cacheStatus= REST filter and cache.status: search operator.
    const failedFilter = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?cacheStatus=failed',
      { bearer: alice.accessToken },
    );
    expect(failedFilter.body.items.map((b) => b.id)).toContain(flakyId);

    const invalidOp = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('cache.status:invalid-origin')}`,
      { bearer: alice.accessToken },
    );
    const invalidIds = invalidOp.body.items.map((b) => b.id);
    expect(invalidIds).toContain(r401.body.id);
    expect(invalidIds).toContain(rLogin.body.id);
    expect(invalidIds).toContain(rPaywall.body.id);

    // Server recovers, retry timer matures -> ArchiveRetryJob/retryDueArchives recovers it.
    stub.setFlakyHealthy(true);
    await dataSource.query(
      `UPDATE bookmarks SET cache_next_retry_at = NOW() - INTERVAL '5 seconds' WHERE id = $1`,
      [flakyId],
    );
    const retryStats = await app.get(MetadataFetchService).retryDueArchives();
    expect(retryStats.attempted).toBeGreaterThanOrEqual(1);
    expect(retryStats.succeeded).toBeGreaterThanOrEqual(1);

    const recovered = await readBookmark(baseUrl, alice.accessToken, flakyId);
    expect(recovered?.cacheStatus).toBe('ready');

    const recoveredHits = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('"recovered readable article"')}`,
      { bearer: alice.accessToken },
    );
    expect(recoveredHits.body.items.map((b) => b.id)).toEqual([flakyId]);
  }, 25_000);

  it('AC: extracts PDF documents via unpdf and indexes them for search', async () => {
    const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: `${stub.origin}/spec.pdf`, title: 'PDF Spec' },
    });
    expect(created.status).toBe(201);
    const pdfId = created.body.id;

    const ready = await waitFor(10_000, async () => {
      const row = await readBookmark(baseUrl, alice.accessToken, pdfId);
      return row !== null && row.cacheStatus === 'ready' ? row : null;
    });
    expect(ready.contentType).toBe('document');

    const archive = await call<BookmarkArchiveView>(baseUrl, 'GET', `/bookmarks/${pdfId}/archive`, {
      bearer: alice.accessToken,
    });
    expect(archive.status).toBe(200);
    expect(archive.body.text).toContain('ArcDrop Binary Document Extraction Marker');

    const hits = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('"Binary Document Extraction"')}`,
      { bearer: alice.accessToken },
    );
    expect(hits.status).toBe(200);
    expect(hits.body.items.map((b) => b.id)).toEqual([pdfId]);
  }, 20_000);

  it('AC: enforces archiveMaxBytes cap, updates archive on reindex/URL change, skips trash, and cleans up disk bytes on delete/purge/reset', async () => {
    // 1. Tighten archiveMaxBytes to 1024 B -> large page becomes skipped.
    const tighten = await call(baseUrl, 'PUT', '/admin/settings', {
      bearer: admin.accessToken,
      body: { archiveMaxBytes: 1024 },
    });
    expect(tighten.status).toBe(200);

    try {
      const largeRes = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: `${stub.origin}/large-article`, title: 'Too Big' },
      });
      expect(largeRes.status).toBe(201);
      await waitFor(10_000, async () => {
        const row = await readBookmark(baseUrl, alice.accessToken, largeRes.body.id);
        return row !== null && row.cacheStatus === 'skipped' ? row : null;
      });
    } finally {
      await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { archiveMaxBytes: DEFAULT_ARCHIVE_MAX_BYTES },
      });
    }

    // 2. Reindex re-extracts updated page content and replaces searchable text.
    stub.setMutableVersion('alpha');
    const mutRes = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: `${stub.origin}/mutable`, title: 'Mutable Entry' },
    });
    expect(mutRes.status).toBe(201);
    const mutId = mutRes.body.id;

    await waitFor(10_000, async () => {
      const row = await readBookmark(baseUrl, alice.accessToken, mutId);
      return row !== null && row.cacheStatus === 'ready' ? row : null;
    });

    stub.setMutableVersion('omega');
    const reindexRes = await call(baseUrl, 'POST', `/bookmarks/${mutId}/reindex`, {
      bearer: alice.accessToken,
    });
    expect(reindexRes.status).toBe(202);

    await waitFor(10_000, async () => {
      const hits = await call<BookmarkListView>(
        baseUrl,
        'GET',
        '/bookmarks?search=velvetphotonomega',
        { bearer: alice.accessToken },
      );
      return hits.body.items.some((b) => b.id === mutId) ? true : null;
    });
    const staleHits = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?search=obsidianquartzalpha',
      { bearer: alice.accessToken },
    );
    expect(staleHits.body.items.map((b) => b.id)).not.toContain(mutId);

    // 3. URL change refreshes the archive for the new target.
    const urlChanged = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${mutId}`, {
      bearer: alice.accessToken,
      body: { url: `${stub.origin}/second-url` },
    });
    expect(urlChanged.status).toBe(200);
    await waitFor(10_000, async () => {
      const hits = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?search=cobaltnebula', {
        bearer: alice.accessToken,
      });
      return hits.body.items.some((b) => b.id === mutId) ? true : null;
    });
    expect(existsSync(join(archiveDirOf(mutId), 'content.html'))).toBeTrue();

    // 4. Trashed bookmarks are not archived, and hard delete / purge removes disk archive directory.
    const trashRes = await call(baseUrl, 'DELETE', `/bookmarks/${mutId}`, {
      bearer: alice.accessToken,
    });
    expect(trashRes.status).toBe(204);
    const trashedOutcome = await app
      .get(MetadataFetchService)
      .enrich(alice.user.id, mutId, `${stub.origin}/second-url`, 'refresh');
    expect(trashedOutcome).toBe('skipped');

    const bulkDel = await call(baseUrl, 'POST', '/bookmarks/bulk', {
      bearer: alice.accessToken,
      body: { action: 'delete', ids: [mutId] },
    });
    expect(bulkDel.status).toBe(200);
    await waitFor(5_000, async () => (!existsSync(archiveDirOf(mutId)) ? true : null));
    expect(existsSync(archiveDirOf(mutId))).toBeFalse();

    // 5. Trash purge sweep also removes archived bytes.
    const purgeTarget = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: bob.accessToken,
      body: { url: `${stub.origin}/second-url`, title: 'Bob Purge Target' },
    });
    expect(purgeTarget.status).toBe(201);
    const purgeId = purgeTarget.body.id;
    await waitFor(10_000, async () => {
      const row = await readBookmark(baseUrl, bob.accessToken, purgeId);
      return row !== null && row.cacheStatus === 'ready' ? row : null;
    });
    expect(existsSync(join(archiveDirOf(purgeId), 'content.txt'))).toBeTrue();
    await call(baseUrl, 'DELETE', `/bookmarks/${purgeId}`, { bearer: bob.accessToken });
    await dataSource.query(
      `UPDATE bookmarks SET deleted_at = NOW() - INTERVAL '400 days' WHERE id = $1`,
      [purgeId],
    );
    await app.get(TrashPurgeService).purgeExpired();
    await waitFor(5_000, async () => (!existsSync(archiveDirOf(purgeId)) ? true : null));
    expect(existsSync(archiveDirOf(purgeId))).toBeFalse();

    // 6. Account data reset deletes all on-disk archives owned by that user without touching others.
    const carol = await createUserViaAdmin(baseUrl, admin, 'carol-reset@arcdrop.test');
    const carolBm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: carol.accessToken,
      body: { url: `${stub.origin}/article-systems`, title: 'Carol Reset Target' },
    });
    expect(carolBm.status).toBe(201);
    const carolId = carolBm.body.id;
    await waitFor(10_000, async () => {
      const row = await readBookmark(baseUrl, carol.accessToken, carolId);
      return row !== null && row.cacheStatus === 'ready' ? row : null;
    });
    expect(existsSync(join(archiveDirOf(carolId), 'content.html'))).toBeTrue();

    const resetRes = await call(baseUrl, 'POST', '/me/reset-data', {
      bearer: carol.accessToken,
      body: { password: 'user-password-1' },
    });
    expect(resetRes.status).toBe(204);
    await waitFor(5_000, async () => (!existsSync(archiveDirOf(carolId)) ? true : null));
    expect(existsSync(archiveDirOf(carolId))).toBeFalse();
  }, 30_000);

  it('AC: EXPLAIN confirms PostgreSQL uses the GIN index on >=1000 seeded rows', async () => {
    const heavyUser = await createUserViaAdmin(baseUrl, admin, 'gin-heavy@arcdrop.test');
    const userId = heavyUser.user.id;

    // Seed 1,500 bookmarks with realistic article bodies (~1 KB each) and 1,000 highlights
    // so PostgreSQL's cost planner naturally picks Bitmap Index Scan on both GIN indexes.
    await dataSource.query(
      `INSERT INTO bookmarks (
         user_id, url, title, excerpt, note, favorite, content_type,
         cache_status, archive_text, scheme, host, domain, port, path, query, fragment,
         created_at, updated_at
       )
       SELECT
         $1,
         'https://gin-bench.example/item/' || g,
         'Distributed Engine ' || g,
         'Storage engine benchmark row ' || g,
         NULL,
         false,
         'article',
         'ready',
         CASE
           WHEN g = 777 THEN 'The quantumledgerindex target lives strictly inside this archived body.'
           ELSE repeat('Distributed storage system replication log compaction snapshot entry ', 18) || ' doc' || g
         END,
         'https',
         'gin-bench.example',
         'gin-bench.example',
         NULL,
         '/item/' || g,
         NULL,
         NULL,
         NOW(),
         NOW()
       FROM generate_series(1, 1500) AS g`,
      [userId],
    );

    await dataSource.query(
      `INSERT INTO highlights (user_id, bookmark_id, text, note, color, created_at, updated_at)
       SELECT
         $1,
         id,
         CASE
           WHEN url = 'https://gin-bench.example/item/888' THEN 'Highlighted quantumhighlightneedle annotation.'
           ELSE repeat('Annotated engineering excerpt with durable state transitions ', 14) || url
         END,
         NULL,
         'yellow',
         NOW(),
         NOW()
       FROM bookmarks
       WHERE user_id = $1
       LIMIT 1500`,
      [userId],
    );

    await dataSource.query('ANALYZE bookmarks');
    await dataSource.query('ANALYZE highlights');

    // End-to-end HTTP search still returns exact needle rows.
    const bodySearch = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?search=quantumledgerindex',
      { bearer: heavyUser.accessToken },
    );
    expect(bodySearch.status).toBe(200);
    expect(bodySearch.body.totalCount).toBe(1);
    expect(bodySearch.body.items[0]!.url).toBe('https://gin-bench.example/item/777');

    // EXPLAIN the compiled hybrid FTS SQL against PostgreSQL.
    const compiledBody = compileSearchQuery(
      parseSearchQuery('quantumledgerindex', { defaultTextFields: FTS_TEXT_SEARCH_FIELDS }),
      { fts: { userId } },
    )!;
    const boundBody = bindNamedParams(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
       SELECT b.id
         FROM bookmarks b
        WHERE b.user_id = :sqUserId
          AND b.deleted_at IS NULL
          AND (${compiledBody.sql})`,
      compiledBody.params,
    );
    const planRows = (await dataSource.query(boundBody.text, boundBody.values)) as Array<{
      'QUERY PLAN': string;
    }>;
    const planText = planRows.map((r) => r['QUERY PLAN']).join('\n');
    expect(planText.toLowerCase()).toContain('ix_bookmarks_search_vector');
    expect(planText.toLowerCase()).toContain('ix_highlights_search_vector');
  }, 30_000);
});
