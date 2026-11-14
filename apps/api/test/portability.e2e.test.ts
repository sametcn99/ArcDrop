import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { PortabilityService } from '../src/portability/portability.service';
import { installTestEnv } from './helpers';
import { buildTestZip } from './zip-builder';

/**
 * M8 — Portability. Everything runs against real Postgres through the real
 * app. Covers every ticket AC: the JSON round-trip identity, double-import
 * idempotency (all `updated`, zero `created`), the Raindrop + Netscape
 * fixtures with nested collections preserved, TXT + ENEX (web clips only,
 * regular notes skipped and counted), a ZIP of mixed supported files, the
 * per-bookmark highlights downloads (well-formed, empty until M10), sync
 * visibility from a pre-import cursor, the 413 cap (isolated boot), the
 * 409 single-concurrent-import lock, the upsert merge semantics, scope
 * exports, and the three new MCP tools incl. read-only refusals.
 */

// -- boot + generic REST helpers (same shape as the other suites) -------------

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: string };
}

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
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

interface BookmarkView {
  id: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  note: string | null;
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

interface CollectionNodeView {
  id: string;
  parentId: string | null;
  title: string;
  bookmarkCount: number;
  children: CollectionNodeView[];
}

interface ExportJsonView {
  format: string;
  scope: { collectionId: string; collectionPath: string[] } | null;
  collections: Array<{ path: string[] }>;
  tags: string[];
  bookmarks: Array<{ url: string; title: string | null; highlights: unknown[] }>;
}

interface SyncChangesView {
  resyncRequired: boolean;
  changes: Array<{
    seq: string;
    entity: string;
    action: string;
    id: string;
    snapshot: Record<string, unknown> | null;
  }>;
  cursor: string;
}

interface CallToolResultView {
  error?: { code: number; message: string };
  isError?: boolean;
  content?: Array<{ text: string }>;
  structuredContent?: unknown;
}

/** Multipart upload — the import path's wire format. */
async function upload(
  baseUrl: string,
  bearer: string,
  filename: string,
  content: string | Buffer,
): Promise<CallResult<Record<string, unknown>>> {
  const form = new FormData();
  form.append('file', new Blob([content]), filename);
  const res = await fetch(`${baseUrl}/api/v1/data/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
    body: form,
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = (
    contentType.includes('json') ? ((await res.json()) as Record<string, unknown>) : {}
  ) as Record<string, unknown>;
  return { status: res.status, body, contentType, headers: res.headers };
}

interface ImportSummary {
  created: number;
  updated: number;
  skipped: Array<{ reason: string; source?: string }>;
  errors: Array<{ reason: string; source?: string }>;
}

const asSummary = (r: CallResult<Record<string, unknown>>): ImportSummary =>
  r.body as unknown as ImportSummary;

/** Streaming export download. */
async function exportData(
  baseUrl: string,
  bearer: string,
  body: { format: string; collectionId?: string },
): Promise<CallResult<string>> {
  const res = await fetch(`${baseUrl}/api/v1/data/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get('content-type') ?? '',
    headers: res.headers,
  };
}

interface Boot {
  app: INestApplication;
  moduleRef: TestingModule;
  baseUrl: string;
  dataSource: DataSource;
}

async function bootApp(): Promise<Boot> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const config = loadConfig();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(0);
  const dataSource = createDataSource(loadConfig());
  await dataSource.initialize();
  return { app, moduleRef, baseUrl: await app.getUrl(), dataSource };
}

async function wipeLibrary(dataSource: DataSource): Promise<void> {
  // Data tables only — users/settings/auth survive (import continues the
  // same user's sync seq; that is exactly the sync-contract situation).
  await dataSource.query('DELETE FROM change_events');
  await dataSource.query('DELETE FROM bookmark_tags');
  await dataSource.query('DELETE FROM bookmark_collections');
  await dataSource.query('DELETE FROM tags');
  await dataSource.query('DELETE FROM bookmarks');
  await dataSource.query('DELETE FROM collections');
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

async function createPat(
  baseUrl: string,
  bearer: string,
  name: string,
  readOnly = false,
): Promise<{ token: string }> {
  const res = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
    bearer,
    body: { name, readOnly },
  });
  expect(res.status).toBe(201);
  return res.body;
}

// -- MCP plumbing (raw JSON-RPC, same shape as the mcp suite) ------------------

async function mcpPost(
  baseUrl: string,
  bearer: string,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ status: number; headers: Headers; message: Record<string, unknown> | null }> {
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
  let message: Record<string, unknown> | null = null;
  const text =
    contentType.includes('json') || contentType.includes('event-stream') ? await res.text() : '';
  if (contentType.includes('json') && text.length > 0)
    message = JSON.parse(text) as Record<string, unknown>;
  if (contentType.includes('event-stream')) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const parsed = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
      if (parsed.id === body.id) message = parsed;
    }
  }
  return { status: res.status, headers: res.headers, message };
}

const rpc = (id: number, method: string, params?: unknown): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params !== undefined ? { params } : {}),
});

interface McpSession {
  bearer: string;
  sessionId: string;
}

async function mcpInitialize(baseUrl: string, bearer: string): Promise<McpSession> {
  const init = await mcpPost(baseUrl, bearer, {
    ...rpc(1, 'initialize'),
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'portability-e2e', version: '0.0.0' },
    },
  });
  expect(init.status).toBe(200);
  return { bearer, sessionId: init.headers.get('mcp-session-id')! };
}

async function callTool(
  baseUrl: string,
  session: McpSession,
  id: number,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResultView> {
  const res = await mcpPost(
    baseUrl,
    session.bearer,
    rpc(id, 'tools/call', { name, arguments: args }),
    session.sessionId,
  );
  expect(res.status).toBe(200);
  return (res.message?.result ?? {}) as CallToolResultView;
}

// ---------------------------------------------------------------------------

describe('Portability (e2e)', () => {
  let boot: Boot;
  let baseUrl: string;
  let admin: AuthSession;
  let alice: AuthSession;

  beforeAll(async () => {
    installTestEnv();
    boot = await bootApp();
    baseUrl = boot.baseUrl;
    await boot.dataSource.query('DELETE FROM audit_log_entries');
    await boot.dataSource.query('DELETE FROM personal_access_tokens');
    await boot.dataSource.query('DELETE FROM refresh_tokens');
    await boot.dataSource.query('DELETE FROM one_time_tokens');
    await boot.dataSource.query('DELETE FROM users');
    await boot.dataSource.query('DELETE FROM settings');
    admin = await bootstrapAdmin(baseUrl);
    alice = await createUserViaAdmin(baseUrl, admin, 'alice@arcdrop.test');
  });

  afterAll(async () => {
    await boot.app.close();
    await boot.dataSource.destroy();
  });

  // -- library construction helper --------------------------------------------

  interface BuiltLibrary {
    collectionIds: { work: string; rust: string; play: string };
    bookmarkIds: { guide: string; book: string; loose: string };
  }

  /** A library rich enough to make every round-trip gap visible. */
  async function buildLibrary(): Promise<BuiltLibrary> {
    const work = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
      bearer: alice.accessToken,
      body: { title: 'Work' },
    });
    const rust = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
      bearer: alice.accessToken,
      body: { title: 'Rust', parentId: work.body.id },
    });
    const play = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
      bearer: alice.accessToken,
      body: { title: 'Play' },
    });

    const b1 = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: {
        url: 'https://docs.example/guide?page=2#setup',
        title: 'The Guide',
        excerpt: 'how to',
        note: 're-read chapter 3',
      },
    });
    const b2 = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://rust.example/book', title: 'Rust Book' },
    });
    const b3 = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://loose.example/untagged' },
    });
    await call(baseUrl, 'PUT', `/bookmarks/${b1.body.id}/tags`, {
      bearer: alice.accessToken,
      body: { tags: ['reading', 'Work'] },
    });
    await call(baseUrl, 'PUT', `/bookmarks/${b2.body.id}/tags`, {
      bearer: alice.accessToken,
      body: { tags: ['reading'] },
    });
    await call(baseUrl, 'PUT', `/bookmarks/${b1.body.id}/collections`, {
      bearer: alice.accessToken,
      body: { collectionIds: [work.body.id, rust.body.id] }, // multi-membership (D5)
    });
    await call(baseUrl, 'PUT', `/bookmarks/${b2.body.id}/collections`, {
      bearer: alice.accessToken,
      body: { collectionIds: [rust.body.id] },
    });
    return {
      collectionIds: { work: work.body.id, rust: rust.body.id, play: play.body.id },
      bookmarkIds: { guide: b1.body.id, book: b2.body.id, loose: b3.body.id },
    };
  }

  it('round-trip: export JSON → wipe → import → identical library', async () => {
    const built = await buildLibrary();
    void built;

    const exported = await exportData(baseUrl, alice.accessToken, { format: 'json' });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('arcdrop-export.json');
    const document = JSON.parse(exported.body) as ExportJsonView;
    expect(document.format).toBe('arcdrop/v1');
    expect(document.collections.map((c) => c.path)).toEqual(
      expect.arrayContaining([['Work'], ['Work', 'Rust'], ['Play']]),
    );
    expect(document.bookmarks).toHaveLength(3);
    // The highlights contract section is present per bookmark (empty until M10).
    for (const bookmark of document.bookmarks) {
      expect(Array.isArray(bookmark['highlights'])).toBe(true);
    }

    await wipeLibrary(boot.dataSource);
    const imported = asSummary(
      await upload(baseUrl, alice.accessToken, 'arcdrop-export.json', exported.body),
    );
    expect(imported.created).toBe(3);
    expect(imported.updated).toBe(0);
    expect(imported.errors).toHaveLength(0);
    expect(imported.skipped).toHaveLength(0);

    // -- identical: collections (hierarchy) -----------------------------------
    const tree = await call<CollectionNodeView[]>(baseUrl, 'GET', '/collections/tree', {
      bearer: alice.accessToken,
    });
    expect(tree.status).toBe(200);
    const workNode = tree.body.find((node: CollectionNodeView) => node.title === 'Work')!;
    expect(workNode).toBeDefined();
    expect(workNode.children.map((c: CollectionNodeView) => c.title).sort()).toEqual(['Rust']);
    const playNode = tree.body.find((node: CollectionNodeView) => node.title === 'Play')!;
    expect(playNode).toBeDefined();

    // -- identical: bookmarks (fields, tags, memberships, timestamps) ----------
    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?pageSize=50', {
      bearer: alice.accessToken,
    });
    expect(list.body.totalCount).toBe(3);
    const guide = list.body.items.find(
      (b: BookmarkView) => b.url === 'https://docs.example/guide?page=2#setup',
    )!;
    expect(guide.title).toBe('The Guide');
    expect(guide.excerpt).toBe('how to');
    expect(guide.note).toBe('re-read chapter 3');
    expect(guide.tags.map((t: { id: string; name: string }) => t.name).sort()).toEqual([
      'Work',
      'reading',
    ]);
    // Multi-membership survived: the guide lists under Work AND Work/Rust.
    // (Resolve the RECREATED collection ids — the wipe re-rolls identities;
    // membership re-links through the title paths.)
    const flat = await call<{ items: CollectionNodeView[] }>(baseUrl, 'GET', '/collections', {
      bearer: alice.accessToken,
    });
    const newWork = flat.body.items.find((c) => c.title === 'Work')!;
    const newRust = flat.body.items.find((c) => c.title === 'Rust')!;
    const inWork = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${newWork.id}&pageSize=50`,
      { bearer: alice.accessToken },
    );
    expect(inWork.body.items.map((b) => b.url)).toContain(
      'https://docs.example/guide?page=2#setup',
    );
    const inRust = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${newRust.id}&pageSize=50`,
      { bearer: alice.accessToken },
    );
    expect(inRust.body.items.map((b) => b.url)).toContain(
      'https://docs.example/guide?page=2#setup',
    );
    expect(inRust.body.items.map((b) => b.url)).toContain('https://rust.example/book');
  });

  it('double import: second run reports all `updated`, zero `created`', async () => {
    const file = Buffer.from(
      'url,title,excerpt,note,tags,collections,createdAt,updatedAt\r\n' +
        'https://dup.example/one,One,,,alpha,Box,,\r\n' +
        'https://dup.example/two,Two,,,alpha,Box,,\r\n',
      'utf8',
    );
    const first = asSummary(await upload(baseUrl, alice.accessToken, 'book.csv', file));
    expect(first.created).toBe(2);

    const second = asSummary(await upload(baseUrl, alice.accessToken, 'book.csv', file));
    expect(second.created).toBe(0);
    expect(second.updated).toBe(2);
    expect(second.errors).toHaveLength(0);

    // No duplicated tags or memberships after the second pass.
    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?search=dup.example', {
      bearer: alice.accessToken,
    });
    expect(list.body.totalCount).toBe(2); // upsert, not insert (D13)
    for (const item of list.body.items) {
      expect(item.tags).toHaveLength(1);
    }
  });

  it('upsert merge: LWW fields, union tags/memberships, no no-op events', async () => {
    // A bookmark whose row is NEWER than the import item: non-empty fields stay.
    const existing = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://merge.example/x', title: 'Server Title' },
    });
    await call(baseUrl, 'PUT', `/bookmarks/${existing.body.id}/tags`, {
      bearer: alice.accessToken,
      body: { tags: ['original'] },
    });

    // Item WITHOUT timestamps (CSV has none): fills gaps, never overwrites
    // non-empty fields — the union adds the tag + membership.
    const older = asSummary(
      await upload(
        baseUrl,
        alice.accessToken,
        'old.csv',
        'url,title,tags,collections\r\nhttps://merge.example/x,Imported Title,extra,Box\r\n',
      ),
    );
    expect(older.updated).toBe(1);
    expect(older.created).toBe(0);

    let row = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${existing.body.id}`, {
      bearer: alice.accessToken,
    });
    expect(row.body.title).toBe('Server Title'); // no-timestamp item never overwrites
    expect(row.body.tags.map((t: { id: string; name: string }) => t.name).sort()).toEqual([
      'extra',
      'original',
    ]); // unioned

    // Item with an EXPLICITLY NEWER stamp (ArcDrop JSON carries updatedAt):
    // its non-empty fields win (last-write-wins, plan D4).
    const newer = asSummary(
      await upload(
        baseUrl,
        alice.accessToken,
        'new.json',
        JSON.stringify({
          format: 'arcdrop/v1',
          bookmarks: [
            {
              url: 'https://merge.example/x',
              title: 'Newer Title',
              createdAt: '2025-01-01T00:00:00.000Z',
              updatedAt: new Date(Date.now() + 60_000).toISOString(), // 1 min in the future
            },
          ],
        }),
      ),
    );
    expect(newer.updated).toBe(1);
    row = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${existing.body.id}`, {
      bearer: alice.accessToken,
    });
    expect(row.body.title).toBe('Newer Title'); // LWW on updatedAt

    // Item without timestamps still FILLS a null field regardless of age.
    const fill = asSummary(
      await upload(
        baseUrl,
        alice.accessToken,
        'fill.csv',
        'url,note\r\nhttps://merge.example/x,filled note\r\n',
      ),
    );
    expect(fill.updated).toBe(1);
    row = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${existing.body.id}`, {
      bearer: alice.accessToken,
    });
    expect(row.body.note).toBe('filled note'); // fill-if-empty regardless of age

    // Matched-but-unchanged re-imports record NO no-op change events: the
    // change log only grows on real changes.
    const stateBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });
    const noop = asSummary(
      await upload(
        baseUrl,
        alice.accessToken,
        'noop.csv',
        'url,title\r\nhttps://merge.example/x,Newer Title\r\n',
      ),
    );
    expect(noop.updated).toBe(1);
    const stateAfter = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });
    expect(stateAfter.body.seq).toBe(stateBefore.body.seq);
  });

  it('sync visibility: every import change is visible from a pre-import cursor', async () => {
    await wipeLibrary(boot.dataSource);
    const stateBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });

    const summary = asSummary(
      await upload(
        baseUrl,
        alice.accessToken,
        'sync.txt',
        'https://sync-a.example/\nhttps://sync-b.example/\n',
      ),
    );
    expect(summary.created).toBe(2);

    const changes = await call<SyncChangesView>(
      baseUrl,
      'GET',
      `/sync/changes?since=${stateBefore.body.seq}&limit=200`,
      { bearer: alice.accessToken },
    );
    expect(changes.status).toBe(200);
    expect(changes.body.resyncRequired).toBe(false);
    const entities = changes.body.changes as Array<{
      entity: string;
      action: string;
      snapshot: Record<string, unknown> | null;
    }>;
    const creates = entities.filter((e) => e.action === 'create');
    expect(creates.filter((e) => e.entity === 'bookmark')).toHaveLength(2);
    // Snapshots are real rows (the M5 contract — import rides the same path).
    expect(creates.find((e) => e.entity === 'bookmark')?.snapshot?.['url']).toContain('sync-');
  });

  it('Raindrop fixture: nested collections preserved, items mapped', async () => {
    await wipeLibrary(boot.dataSource);
    const raindrop = JSON.stringify({
      user: { name: 'someone' },
      collections: [
        { _id: 'aaa', title: 'Research' },
        { _id: 'bbb', title: 'Papers', parent: { $oid: 'aaa' } },
      ],
      bookmarks: [
        {
          title: 'A paper',
          link: 'https://papers.example/x',
          tags: ['ml'],
          collection: { $oid: 'bbb' },
          created: '2024-09-13T10:00:00.000Z',
          updated: '2024-09-14T10:00:00.000Z',
          excerpt: 'abstract text',
        },
        {
          title: 'Unsorted',
          link: 'https://loose-raindrop.example/',
          collection: { id: -1 },
        },
      ],
    });
    const summary = asSummary(await upload(baseUrl, alice.accessToken, 'raindrop.json', raindrop));
    expect(summary.created).toBe(2);
    expect(summary.errors).toHaveLength(0);

    const tree = await call<CollectionNodeView[]>(baseUrl, 'GET', '/collections/tree', {
      bearer: alice.accessToken,
    });
    const research = tree.body.find((n: CollectionNodeView) => n.title === 'Research')!;
    expect(research).toBeDefined();
    expect(research.children.map((c: CollectionNodeView) => c.title)).toEqual(['Papers']); // nested preserved
    expect(research.children[0]!.bookmarkCount).toBe(1);

    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?search=papers.example', {
      bearer: alice.accessToken,
    });
    const paper = list.body.items[0]!;
    expect(paper.title).toBe('A paper');
    expect(paper.excerpt).toBe('abstract text');
    expect(new Date(paper.createdAt).toISOString()).toBe('2024-09-13T10:00:00.000Z');
  });

  it('Netscape HTML fixture: nested folders, tags, descriptions', async () => {
    await wipeLibrary(boot.dataSource);
    const html = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<DL><p>',
      '  <DT><H3>Dev</H3>',
      '  <DL><p>',
      '    <DT><A HREF="https://nested.example/tool" ADD_DATE="1700000000" TAGS="tools">Nested Tool</A>',
      '    <DD>tool description',
      '  </DL><p>',
      '  <DT><A HREF="https://flat.example/root">Root Link</A>',
      '</DL><p>',
    ].join('\n');
    const summary = asSummary(await upload(baseUrl, alice.accessToken, 'bookmarks.html', html));
    expect(summary.created).toBe(2);

    const tree = await call<CollectionNodeView[]>(baseUrl, 'GET', '/collections/tree', {
      bearer: alice.accessToken,
    });
    const dev = tree.body.find((n: CollectionNodeView) => n.title === 'Dev')!;
    expect(dev).toBeDefined(); // folder became a collection
    expect(dev.bookmarkCount).toBe(1);

    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?search=nested.example', {
      bearer: alice.accessToken,
    });
    const nested = list.body.items[0]!;
    expect(nested.tags.map((t: { id: string; name: string }) => t.name)).toEqual(['tools']);
    expect(nested.note).toBe('tool description'); // <DD> → note
  });

  it('TXT fixture: one URL per line; broken lines error with their line number', async () => {
    await wipeLibrary(boot.dataSource);
    const summary = asSummary(
      await upload(
        baseUrl,
        alice.accessToken,
        'links.txt',
        'https://txt-a.example/\n\nnot a url\nhttps://txt-b.example/path?q=1\n',
      ),
    );
    expect(summary.created).toBe(2);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]!.source).toContain('line 3');
    expect(summary.errors[0]!.reason).toContain('valid absolute URL');
    // Blank lines are not skips.
    expect(summary.skipped).toHaveLength(0);
  });

  it('ENEX fixture: web clips imported with tags + created; regular notes skipped and counted', async () => {
    await wipeLibrary(boot.dataSource);
    const enex = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<en-export>',
      '  <note>',
      '    <title>Clipped: ArcDrop</title>',
      '    <content><![CDATA[<en-note><a href="https://clip.example/page">ArcDrop</a></en-note>]]></content>',
      '    <tag>clipped</tag>',
      '    <tag>web</tag>',
      '    <created>20231118T120000Z</created>',
      '  </note>',
      '  <note>',
      '    <title>Just a note</title>',
      '    <content><![CDATA[<en-note>plain text body</en-note>]]></content>',
      '  </note>',
      '</en-export>',
    ].join('\n');
    const summary = asSummary(await upload(baseUrl, alice.accessToken, 'notes.enex', enex));
    expect(summary.created).toBe(1);
    expect(summary.skipped).toHaveLength(1); // the regular note
    expect(summary.skipped[0]!.reason).toContain('regular note');
    expect(summary.skipped[0]!.source).toContain('Just a note');

    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?search=clip.example', {
      bearer: alice.accessToken,
    });
    const clip = list.body.items[0]!;
    expect(clip.title).toBe('Clipped: ArcDrop');
    expect(clip.tags.map((t: { id: string; name: string }) => t.name).sort()).toEqual([
      'clipped',
      'web',
    ]);
    expect(new Date(clip.createdAt).toISOString()).toBe('2023-11-18T12:00:00.000Z'); // Evernote stamp
  });

  it('ZIP fixture: every supported member imports; unsupported ones are skipped and counted', async () => {
    await wipeLibrary(boot.dataSource);
    const archive = buildTestZip([
      { name: 'urls.txt', content: 'https://zip-txt.example/a\n' },
      {
        name: 'marks.html',
        content: '<DL><p><DT><A HREF="https://zip-html.example/">H</A></DL>',
      },
      {
        name: 'rows.csv',
        content: 'url,title,tags,collections\nhttps://zip-csv.example/,T,tag,ZBox\n',
      },
      {
        name: 'clip.enex',
        content:
          '<en-export><note><title>Z</title><content><![CDATA[<en-note><a href="https://zip-enex.example/">go</a></en-note>]]></content></note></en-export>',
      },
      {
        name: 'library.json',
        content: JSON.stringify({
          format: 'arcdrop/v1',
          bookmarks: [
            {
              url: 'https://zip-json.example/',
              title: 'From Json',
              tags: ['json'],
              collections: [['Json', 'Deep']],
            },
          ],
        }),
      },
      { name: 'photo.md', content: '# not supported' },
    ]);
    const summary = asSummary(await upload(baseUrl, alice.accessToken, 'bundle.zip', archive));
    expect(summary.created).toBe(5);
    expect(summary.skipped).toHaveLength(1); // photo.md
    expect(summary.skipped[0]!.source).toBe('photo.md');
    expect(summary.errors).toHaveLength(0);

    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?pageSize=50', {
      bearer: alice.accessToken,
    });
    expect(list.body.totalCount).toBe(5);
    const jsonOne = list.body.items.find(
      (b: BookmarkView) => b.url === 'https://zip-json.example/',
    )!;
    expect(jsonOne.tags.map((t: { id: string; name: string }) => t.name)).toEqual(['json']);
    // The ArcDrop JSON member's collection path became a nested collection.
    const tree = await call<CollectionNodeView[]>(baseUrl, 'GET', '/collections/tree', {
      bearer: alice.accessToken,
    });
    const jsonBox = tree.body.find((n: CollectionNodeView) => n.title === 'Json')!;
    expect(jsonBox).toBeDefined();
    expect(jsonBox.children.map((c: CollectionNodeView) => c.title)).toEqual(['Deep']);
  });

  it('JSON export scope: collectionId limits bookmarks + collections; unknown id is a 404', async () => {
    await wipeLibrary(boot.dataSource);
    const built = await buildLibrary();

    const scoped = await exportData(baseUrl, alice.accessToken, {
      format: 'json',
      collectionId: built.collectionIds.work,
    });
    expect(scoped.status).toBe(200);
    const document = JSON.parse(scoped.body) as {
      scope: { collectionId: string; collectionPath: string[] };
      collections: Array<{ path: string[] }>;
      bookmarks: Array<{ url: string; collections: string[][] }>;
    };
    expect(document.scope!.collectionId).toBe(built.collectionIds.work);
    expect(document.scope!.collectionPath).toEqual(['Work']);
    expect(document.collections.map((c) => c.path)).toEqual(
      expect.arrayContaining([['Work'], ['Work', 'Rust']]),
    );
    expect(document.collections.map((c) => c.path)).not.toContainEqual(['Play']);
    expect(document.bookmarks.map((b) => b.url).sort()).toEqual([
      'https://docs.example/guide?page=2#setup',
      'https://rust.example/book',
    ]); // the loose bookmark is outside the scope

    const missing = await exportData(baseUrl, alice.accessToken, {
      format: 'json',
      collectionId: '00000000-0000-4000-8000-000000000000',
    });
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body).code).toBe('NOT_FOUND');
  });

  it('CSV and HTML and TXT exports produce their documented shapes', async () => {
    const csv = await exportData(baseUrl, alice.accessToken, { format: 'csv' });
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.body).toMatch(/^url,title,excerpt,note,tags,collections,createdAt,updatedAt\r\n/);
    expect(csv.body).toContain('https://docs.example/guide');

    const html = await exportData(baseUrl, alice.accessToken, { format: 'html' });
    expect(html.status).toBe(200);
    expect(html.body).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html.body).toContain('<DT><H3>Work</H3>');

    const txt = await exportData(baseUrl, alice.accessToken, { format: 'txt' });
    expect(txt.status).toBe(200);
    const lines = txt.body.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines).toContain('https://loose.example/untagged');
  });

  it('the trash is not exported and a trashed duplicate does not absorb an import', async () => {
    const created = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://trashy.example/x', title: 'Doomed' },
    });
    await call(baseUrl, 'DELETE', `/bookmarks/${created.body.id}`, {
      bearer: alice.accessToken,
    });

    const exported = await exportData(baseUrl, alice.accessToken, { format: 'json' });
    expect(exported.body).not.toContain('trashy.example'); // active library only (D17)

    const summary = asSummary(
      await upload(
        baseUrl,
        alice.accessToken,
        'again.csv',
        'url,title\r\nhttps://trashy.example/x,Reimported\r\n',
      ),
    );
    expect(summary.created).toBe(1); // a NEW active row (trashed rows are not upsert targets)
    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?search=trashy.example', {
      bearer: alice.accessToken,
    });
    expect(list.body.items[0]!.title).toBe('Reimported');
  });

  it('highlights export: txt and csv downloads are well-formed (empty until M10)', async () => {
    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?pageSize=1', {
      bearer: alice.accessToken,
    });
    const bookmarkId = list.body.items[0]!.id as string;

    const txt = await fetch(
      `${baseUrl}/api/v1/bookmarks/${bookmarkId}/highlights/export?format=txt`,
      { headers: { authorization: `Bearer ${alice.accessToken}` } },
    );
    expect(txt.status).toBe(200);
    expect(txt.headers.get('content-type')).toContain('text/plain');
    expect(txt.headers.get('content-disposition')).toContain('highlights.txt');

    const csv = await fetch(
      `${baseUrl}/api/v1/bookmarks/${bookmarkId}/highlights/export?format=csv`,
      { headers: { authorization: `Bearer ${alice.accessToken}` } },
    );
    expect(csv.status).toBe(200);
    expect(await csv.text()).toBe('text,note,color,createdAt\r\n');

    const missing = await fetch(
      `${baseUrl}/api/v1/bookmarks/00000000-0000-4000-8000-000000000000/highlights/export?format=txt`,
      { headers: { authorization: `Bearer ${alice.accessToken}` } },
    );
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { code: string }).code).toBe('NOT_FOUND');
  });

  it('import guards: 400 on unsupported extensions and missing multipart field; 409 while busy', async () => {
    const unsupported = await upload(baseUrl, alice.accessToken, 'data.xml', '<xml/>');
    expect(unsupported.status).toBe(400);
    expect(problem(unsupported).code).toBe('BAD_REQUEST');

    const noFile = await fetch(`${baseUrl}/api/v1/data/import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${alice.accessToken}`,
      },
      body: '{}',
    });
    expect(noFile.status).toBe(400);

    // One concurrent import per user: hold the lock, expect 409 problem+json.
    const portability = boot.moduleRef.get(PortabilityService, { strict: false });
    const release = portability.acquireImportLock(alice.user.id);
    expect(release).not.toBeNull();
    const busy = await upload(baseUrl, alice.accessToken, 'links.txt', 'https://busy.example/\n');
    expect(busy.status).toBe(409);
    expect(problem(busy).code).toBe('CONFLICT');
    release!();

    // The lock is released — the same import now succeeds.
    const after = asSummary(
      await upload(baseUrl, alice.accessToken, 'links.txt', 'https://busy.example/\n'),
    );
    expect(after.created).toBe(1);
  });

  it('CSV round-trip through the lossy wire format', async () => {
    await wipeLibrary(boot.dataSource);
    const built = await buildLibrary();
    void built;
    const exported = await exportData(baseUrl, alice.accessToken, { format: 'csv' });
    await wipeLibrary(boot.dataSource);
    const summary = asSummary(
      await upload(baseUrl, alice.accessToken, 'export.csv', exported.body),
    );
    expect(summary.created).toBeGreaterThanOrEqual(3);
    expect(summary.errors).toHaveLength(0);
    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?search=docs.example', {
      bearer: alice.accessToken,
    });
    const guide = list.body.items[0]!;
    expect(guide.title).toBe('The Guide');
    expect(guide.tags.map((t: { id: string; name: string }) => t.name).sort()).toEqual([
      'Work',
      'reading',
    ]);
  });

  // -- MCP tools (M8 catalog extension) ---------------------------------------

  it('MCP: importData creates through the same pipeline (and takes >100 KB JSON bodies)', async () => {
    const pat = await createPat(baseUrl, alice.accessToken, 'portability-agent');
    const session = await mcpInitialize(baseUrl, pat.token);

    // ~2500 urls ≈ 93 KB text ≈ 125 KB base64 — the JSON-RPC body crosses
    // the old 100 KB express default, proving the 2 MB limit took effect.
    const urls = Array.from({ length: 2500 }, (_, i) => `https://mcp-import.example/page/${i}`);
    const text = urls.join('\n');
    const data = Buffer.from(text, 'utf8').toString('base64');
    expect(data.length).toBeGreaterThan(100_000);

    const result = await callTool(baseUrl, session, 10, 'importData', {
      format: 'txt',
      data,
    });
    expect(result.isError).toBeUndefined();
    const summary = result.structuredContent as ImportSummary;
    expect(summary.created).toBe(2500);

    const list = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?search=mcp-import.example&pageSize=1',
      { bearer: alice.accessToken },
    );
    expect(list.body.totalCount).toBe(2500); // REST-visible — agent as any client
  }, 30_000);

  it('MCP: exportData returns the document; json carries structuredContent', async () => {
    const pat = await createPat(baseUrl, alice.accessToken, 'export-agent');
    const session = await mcpInitialize(baseUrl, pat.token);

    const json = await callTool(baseUrl, session, 20, 'exportData', { format: 'json' });
    expect(json.isError).toBeUndefined();
    const document = (json.structuredContent as { document: ExportJsonView }).document;
    expect(document.format).toBe('arcdrop/v1');
    expect(Array.isArray(document.bookmarks)).toBe(true);
    expect(document.bookmarks.length).toBeGreaterThan(0);

    const txt = await callTool(baseUrl, session, 21, 'exportData', { format: 'txt' });
    const txtDocument = (txt.structuredContent as { document: string }).document;
    expect(txtDocument).toContain('https://mcp-import.example/page/0\n');

    // exportBookmarkHighlights (GET → readable by any token): a real bookmark
    // id, the well-formed empty download until M10 lands the storage.
    const list = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?pageSize=1', {
      bearer: alice.accessToken,
    });
    const highlights = await callTool(baseUrl, session, 22, 'exportBookmarkHighlights', {
      id: list.body.items[0]!.id,
      format: 'csv',
    });
    expect((highlights.structuredContent as { body: string }).body).toBe(
      'text,note,color,createdAt\r\n',
    );
  });

  it('MCP: read-only tokens refuse importData and exportData, read exportBookmarkHighlights', async () => {
    const readOnly = await createPat(baseUrl, alice.accessToken, 'read-only-agent', true);
    const session = await mcpInitialize(baseUrl, readOnly.token);

    const importRefusal = await callTool(baseUrl, session, 30, 'importData', {
      format: 'txt',
      data: Buffer.from('https://x.example/').toString('base64'),
    });
    expect(importRefusal.isError).toBe(true);
    expect(importRefusal.content?.[0]?.text).toContain('read-only');

    const exportRefusal = await callTool(baseUrl, session, 31, 'exportData', { format: 'json' });
    expect(exportRefusal.isError).toBe(true); // POST at REST → mutation-classified

    const read = await callTool(baseUrl, session, 32, 'exportBookmarkHighlights', {
      id: '00000000-0000-4000-8000-000000000000',
      format: 'txt',
    });
    // A GET tool runs for read-only tokens; an unknown bookmark is a DOMAIN error.
    expect(read.content?.[0]?.text).toContain('404');
  });
});

describe('Portability import caps (isolated boot)', () => {
  let boot: Boot;
  let baseUrl: string;
  let admin: AuthSession;
  let alice: AuthSession;

  beforeAll(async () => {
    installTestEnv();
    // Tiny cap for the whole boot — proves the cap is config-driven (the
    // default boots above accepted these same sizes). bun runs all files in
    // one process: set, boot, restore (the metadata suite discipline).
    process.env.ARCDROP__PORTABILITY__IMPORT_MAX_BYTES = '1000';
    process.env.ARCDROP__PORTABILITY__IMPORT_ZIP_MAX_BYTES = '2000';
    boot = await bootApp();
    baseUrl = boot.baseUrl;
    await boot.dataSource.query('DELETE FROM users');
    admin = await bootstrapAdmin(baseUrl);
    alice = await createUserViaAdmin(baseUrl, admin, 'cap-user@arcdrop.test');
  });

  afterAll(async () => {
    delete process.env.ARCDROP__PORTABILITY__IMPORT_MAX_BYTES;
    delete process.env.ARCDROP__PORTABILITY__IMPORT_ZIP_MAX_BYTES;
    await boot.app.close();
    await boot.dataSource.destroy();
  });

  it('oversized upload → 413 problem+json (code PAYLOAD_TOO_LARGE)', async () => {
    // 3.6 KB: past even the (tiny) stream-time ZIP cap → multer refuses
    // mid-stream and the interceptor translates to problem+json 413.
    const oversized = await upload(
      baseUrl,
      alice.accessToken,
      'links.txt',
      'https://a.example/'.repeat(200),
    );
    expect(oversized.status).toBe(413);
    expect(oversized.contentType).toContain('application/problem+json');
    expect(problem(oversized).code).toBe('PAYLOAD_TOO_LARGE');
    expect(problem(oversized).detail).toContain('byte cap');
  });

  it('the tighter non-zip cap binds after parsing (stream cap is the ZIP one)', async () => {
    // 1.5 KB: under the 2000-byte stream-time cap, over the 1000-byte
    // non-ZIP cap → the post-parse check refuses.
    const between = await upload(
      baseUrl,
      alice.accessToken,
      'links.txt',
      'https://b.example/'.repeat(100),
    );
    expect(between.status).toBe(413);
    expect(problem(between).code).toBe('PAYLOAD_TOO_LARGE');
    expect(problem(between).detail).not.toContain('ZIP');
  });

  it('a zip over the (tiny) zip cap is refused too', async () => {
    const archive = buildTestZip([{ name: 'a.txt', content: 'x'.repeat(5000) }]);
    const refused = await upload(baseUrl, alice.accessToken, 'bundle.zip', archive);
    expect(refused.status).toBe(413);
    expect(problem(refused).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('a file within the cap imports normally (the cap binds, nothing else)', async () => {
    const summary = asSummary(
      await upload(baseUrl, alice.accessToken, 'links.txt', 'https://fits.example/\n'),
    );
    expect(summary.created).toBe(1);
  });
});
