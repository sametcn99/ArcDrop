import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { installTestEnv } from './helpers';

/**
 * M11 — Search operators (plan D19 / parity G9; extended M12/M14/M17/M18) — real
 * HTTP + MCP against real Postgres. Covers every operator in the canonical
 * grammar, precedence (`match:OR` vs default AND, exclusions always ANDed),
 * NULL-safe negations, `q` alias + `search`+`q` conflict, composability with
 * REST filters (`collectionId`, `trashed`, `domain`, `updatedSince`),
 * active `file:` filtering + invalid-value 400s, unknown-operator 400s with
 * position, OpenAPI docs, and MCP `listBookmarks`.
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
  await dataSource.query('DELETE FROM upload_usage');
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

describe('Search operators M11 (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let document: OpenAPIObject;
  let admin: AuthSession;
  let patToken: string;
  let engineeringCollectionId: string;

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();

    const booted = await bootApp();
    app = booted.app;
    baseUrl = booted.baseUrl;
    document = booted.document;
    dataSource = app.get(DataSource);
    await wipeData(dataSource);

    const boot = await call<AuthSession>(baseUrl, 'POST', '/auth/bootstrap', {
      body: { email: 'search-ops@arcdrop.test', password: 'root-password-1' },
    });
    expect(boot.status).toBe(201);
    admin = boot.body;

    const pat = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
      bearer: admin.accessToken,
      body: { name: 'Search MCP PAT', readOnly: true },
    });
    expect(pat.status).toBe(201);
    patToken = pat.body.token;

    const col = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
      bearer: admin.accessToken,
      body: { title: 'Engineering' },
    });
    expect(col.status).toBe(201);
    engineeringCollectionId = col.body.id;

    const fixtures: Array<{
      key: string;
      url: string;
      title: string | null;
      excerpt: string | null;
      note: string | null;
      favorite: boolean;
      contentType: string;
      tags: string[];
      createdAt: string;
      updatedAt: string;
      inCollection?: boolean;
      trashed?: boolean;
    }> = [
      {
        key: 'rustArticle',
        url: 'https://rust-lang.org/async-book',
        title: 'Rust Async Runtime Guide',
        excerpt: 'Deep dive into tokio tasks',
        note: 'Read chapter 3 carefully',
        favorite: true,
        contentType: 'article',
        tags: ['Rust', 'Web Dev'],
        createdAt: '2024-06-15T12:00:00.000Z',
        updatedAt: '2025-01-10T10:00:00.000Z',
        inCollection: true,
      },
      {
        key: 'tokioVideo',
        url: 'https://youtube.com/watch?v=tokio123',
        title: 'Tokio Video Tutorial',
        excerpt: 'Live coding async streams',
        note: null,
        favorite: true,
        contentType: 'video',
        tags: ['Rust', 'Video'],
        createdAt: '2025-02-20T08:00:00.000Z',
        updatedAt: '2025-02-25T15:00:00.000Z',
      },
      {
        key: 'patternsPdf',
        url: 'https://archive.example.org/design-patterns.pdf',
        title: 'Design Patterns PDF',
        excerpt: null,
        note: 'Great reference for "quoted" GoF patterns',
        favorite: false,
        contentType: 'document',
        tags: ['Architecture', 'Web Dev'],
        createdAt: '2025-05-05T09:00:00.000Z',
        updatedAt: '2025-05-20T18:00:00.000Z',
        inCollection: true,
      },
      {
        key: 'untaggedLink',
        url: 'https://news.ycombinator.com/item?id=999',
        title: 'Untagged Quick Link',
        excerpt: 'No tags attached here',
        note: 'Review later',
        favorite: false,
        contentType: 'link',
        tags: [],
        createdAt: '2025-05-25T00:00:00.000Z',
        updatedAt: '2025-06-01T12:00:00.000Z',
      },
      {
        key: 'posterImage',
        url: 'https://imgur.com/gallery/rust-poster',
        title: null,
        excerpt: 'Album art cover',
        note: null,
        favorite: true,
        contentType: 'image',
        tags: ['Art', 'Legacy'],
        createdAt: '2023-11-10T14:00:00.000Z',
        updatedAt: '2024-01-05T11:00:00.000Z',
      },
      {
        key: 'trashedRust',
        url: 'https://rust-lang.org/trashed-notes',
        title: 'Trashed Rust Notes',
        excerpt: 'Old draft',
        note: 'Should only appear when trashed=true',
        favorite: true,
        contentType: 'article',
        tags: ['Rust'],
        createdAt: '2025-05-05T10:00:00.000Z',
        updatedAt: '2025-05-06T10:00:00.000Z',
        trashed: true,
      },
    ];

    for (const fx of fixtures) {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: {
          url: fx.url,
          title: fx.title,
          excerpt: fx.excerpt,
          note: fx.note,
          favorite: fx.favorite,
        },
      });
      expect(created.status).toBe(201);
      ids[fx.key] = created.body.id;

      if (fx.tags.length > 0) {
        const tagged = await call(baseUrl, 'PUT', `/bookmarks/${created.body.id}/tags`, {
          bearer: admin.accessToken,
          body: { tags: fx.tags },
        });
        expect(tagged.status).toBe(200);
      }

      if (fx.inCollection) {
        const linked = await call(baseUrl, 'PUT', `/bookmarks/${created.body.id}/collections`, {
          bearer: admin.accessToken,
          body: { collectionIds: [engineeringCollectionId] },
        });
        expect(linked.status).toBe(200);
      }

      if (fx.trashed) {
        const trashed = await call(baseUrl, 'DELETE', `/bookmarks/${created.body.id}`, {
          bearer: admin.accessToken,
        });
        expect(trashed.status).toBe(204);
      }

      await dataSource.query(
        'UPDATE bookmarks SET content_type = $1, created_at = $2, updated_at = $3 WHERE id = $4',
        [fx.contentType, fx.createdAt, fx.updatedAt, created.body.id],
      );
    }
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await app.close();
  });

  async function searchIds(query: string, extra = ''): Promise<string[]> {
    const sep = extra ? `&${extra}` : '';
    const res = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent(query)}&pageSize=50${sep}`,
      { bearer: admin.accessToken },
    );
    expect(res.status).toBe(200);
    return res.body.items.map((item) => item.id).sort();
  }

  function expectedIds(...keys: string[]): string[] {
    return keys.map((k) => ids[k]!).sort();
  }

  it('matches bare words across title, excerpt, note, url, and tags', async () => {
    // Note match
    expect(await searchIds('chapter')).toEqual(expectedIds('rustArticle'));
    // Tag + title + url match ('rust' in rustArticle title/url/tag, tokioVideo tag, posterImage url)
    expect(await searchIds('rust')).toEqual(
      expectedIds('rustArticle', 'tokioVideo', 'posterImage'),
    );
    // Excerpt match
    expect(await searchIds('streams')).toEqual(expectedIds('tokioVideo'));
    // URL match
    expect(await searchIds('ycombinator')).toEqual(expectedIds('untaggedLink'));
  });

  it('supports exact phrases, escaped quotes, and NULL-safe -word / -"phrase" exclusions', async () => {
    expect(await searchIds('"async runtime"')).toEqual(expectedIds('rustArticle'));
    expect(await searchIds('"runtime async"')).toEqual([]);
    expect(await searchIds('"\\"quoted\\" GoF"')).toEqual(expectedIds('patternsPdf'));

    // Exclusion on nullable columns (posterImage has title=null, note=null; patternsPdf has excerpt=null)
    expect(await searchIds('-tokio -legacy')).toEqual(expectedIds('patternsPdf', 'untaggedLink'));
    expect(await searchIds('rust -"async runtime"')).toEqual(
      expectedIds('tokioVideo', 'posterImage'),
    );
  });

  it('supports #tag, -#tag, #"multi word tag", and -#"multi word tag"', async () => {
    expect(await searchIds('#rust')).toEqual(expectedIds('rustArticle', 'tokioVideo'));
    expect(await searchIds('#"web dev"')).toEqual(expectedIds('rustArticle', 'patternsPdf'));
    expect(await searchIds('#"web dev" -#rust')).toEqual(expectedIds('patternsPdf'));
    expect(await searchIds('-#legacy -#rust')).toEqual(expectedIds('patternsPdf', 'untaggedLink'));
  });

  it('supports field-scoped title:, excerpt:, note:, and link: (including negations)', async () => {
    expect(await searchIds('title:rust')).toEqual(expectedIds('rustArticle'));
    expect(await searchIds('excerpt:"album art"')).toEqual(expectedIds('posterImage'));
    expect(await searchIds('note:review')).toEqual(expectedIds('untaggedLink'));
    expect(await searchIds('link:youtube.com')).toEqual(expectedIds('tokioVideo'));
    expect(await searchIds('link:rust-poster -title:anything')).toEqual(expectedIds('posterImage'));
  });

  it('supports type:, favorite:, and notag: operators', async () => {
    expect(await searchIds('type:video')).toEqual(expectedIds('tokioVideo'));
    expect(await searchIds('type:document')).toEqual(expectedIds('patternsPdf'));
    expect(await searchIds('favorite:true')).toEqual(
      expectedIds('rustArticle', 'tokioVideo', 'posterImage'),
    );
    expect(await searchIds('-favorite:true')).toEqual(expectedIds('patternsPdf', 'untaggedLink'));
    expect(await searchIds('notag:true')).toEqual(expectedIds('untaggedLink'));
    expect(await searchIds('notag:false -favorite:true')).toEqual(expectedIds('patternsPdf'));
  });

  it('supports created: and lastUpdate: date operators with YYYY[-MM[-DD]] and <, >, <=, >=', async () => {
    expect(await searchIds('created:2025')).toEqual(
      expectedIds('tokioVideo', 'patternsPdf', 'untaggedLink'),
    );
    expect(await searchIds('created:2025-05')).toEqual(expectedIds('patternsPdf', 'untaggedLink'));
    expect(await searchIds('created:2025-05-05')).toEqual(expectedIds('patternsPdf'));
    expect(await searchIds('created:<2025-01-01')).toEqual(
      expectedIds('rustArticle', 'posterImage'),
    );
    expect(await searchIds('created:>2025-05-05')).toEqual(expectedIds('untaggedLink'));
    expect(await searchIds('lastUpdate:>=2025-05-20')).toEqual(
      expectedIds('patternsPdf', 'untaggedLink'),
    );
    expect(await searchIds('lastUpdate:<=2025-02-25')).toEqual(
      expectedIds('rustArticle', 'tokioVideo', 'posterImage'),
    );
  });

  it('supports match:OR vs default AND and keeps exclusions ANDed', async () => {
    // Default AND
    expect(await searchIds('#Rust type:video')).toEqual(expectedIds('tokioVideo'));
    // match:OR
    expect(await searchIds('match:OR #Rust type:document')).toEqual(
      expectedIds('rustArticle', 'tokioVideo', 'patternsPdf'),
    );
    // match:OR with exclusion — exclusion still filters out video
    expect(await searchIds('match:OR #Rust type:document -type:video')).toEqual(
      expectedIds('rustArticle', 'patternsPdf'),
    );
  });

  it('executes complex multi-operator combinations', async () => {
    expect(await searchIds('#Rust -#"Web Dev" type:video created:2025 favorite:true')).toEqual(
      expectedIds('tokioVideo'),
    );
  });

  it('supports q alias and rejects conflicting search + q with 400', async () => {
    const qRes = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?q=${encodeURIComponent('#"Web Dev" type:article')}`,
      { bearer: admin.accessToken },
    );
    expect(qRes.status).toBe(200);
    expect(qRes.body.items.map((b) => b.id)).toEqual([ids.rustArticle!]);

    const both = await call(baseUrl, 'GET', '/bookmarks?search=rust&q=tokio', {
      bearer: admin.accessToken,
    });
    expect(both.status).toBe(400);
    expect(both.contentType).toContain('application/problem+json');
    expect(problem(both).code).toBe('BAD_REQUEST');
  });

  it('composes grammar filters via AND with collectionId, trashed, domain, and updatedSince', async () => {
    expect(
      await searchIds('#"Web Dev" type:document', `collectionId=${engineeringCollectionId}`),
    ).toEqual(expectedIds('patternsPdf'));

    expect(await searchIds('#Rust', 'trashed=true')).toEqual(expectedIds('trashedRust'));

    expect(await searchIds('favorite:true', 'domain=rust-lang.org')).toEqual(
      expectedIds('rustArticle'),
    );

    expect(
      await searchIds('rust', `updatedSince=${encodeURIComponent('2025-02-01T00:00:00.000Z')}`),
    ).toEqual(expectedIds('tokioVideo'));
  });

  it('supports active file: operator (M18) and rejects invalid file: values with 400', async () => {
    // All fixtures here are URL-backed; file:false matches all 5 active rows and file:true/file:pdf return [].
    expect(await searchIds('file:false')).toEqual(
      expectedIds('rustArticle', 'tokioVideo', 'patternsPdf', 'untaggedLink', 'posterImage'),
    );
    expect(await searchIds('file:true')).toEqual([]);
    expect(await searchIds('file:pdf')).toEqual([]);

    const invalidFileOp = await call(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('file:bogus')}`,
      { bearer: admin.accessToken },
    );
    expect(invalidFileOp.status).toBe(400);
    expect(invalidFileOp.contentType).toContain('application/problem+json');
    expect(problem(invalidFileOp).code).toBe('BAD_REQUEST');
  });

  it('returns 400 problem+json with position for unknown operators and syntax errors', async () => {
    const unknown = await call(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('rust author:alice')}`,
      { bearer: admin.accessToken },
    );
    expect(unknown.status).toBe(400);
    expect(unknown.contentType).toContain('application/problem+json');
    expect(problem(unknown).code).toBe('BAD_REQUEST');
    expect(problem(unknown).detail).toContain('position 5');

    const badDate = await call(
      baseUrl,
      'GET',
      `/bookmarks?q=${encodeURIComponent('created:2025-02-29')}`,
      { bearer: admin.accessToken },
    );
    expect(badDate.status).toBe(400);
    expect(problem(badDate).detail).toContain('position 8');

    const unterminated = await call(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('"unterminated')}`,
      { bearer: admin.accessToken },
    );
    expect(unterminated.status).toBe(400);
    expect(problem(unterminated).detail).toContain('position 0');
  });

  it('documents search and q parameters with M11/M12/M14/M17/M18 grammar in OpenAPI', () => {
    const listOp = (
      document.paths['/api/v1/bookmarks'] as {
        get: {
          description?: string;
          parameters?: Array<{ name: string; in: string; description?: string }>;
        };
      }
    ).get;
    expect(listOp.description).toContain('match:OR');
    expect(listOp.description).toContain('broken:');
    expect(listOp.description).toContain('reminder:');
    expect(listOp.description).toContain('file:');
    const searchParam = listOp.parameters?.find((p) => p.name === 'search' && p.in === 'query');
    const qParam = listOp.parameters?.find((p) => p.name === 'q' && p.in === 'query');
    expect(searchParam?.description).toContain('notag:true|false');
    expect(qParam?.description).toContain('Alias for `search`');
  });

  it('supports M11/M12/M14/M17/M18 search grammar and error propagation through MCP listBookmarks', async () => {
    const init = await mcpPost(baseUrl, patToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'm11-e2e', version: '0.0.0' },
      },
    });
    expect(init.status).toBe(200);
    const sessionId = init.sessionId!;

    const tools = await mcpPost(
      baseUrl,
      patToken,
      { jsonrpc: '2.0', id: 10, method: 'tools/list' },
      sessionId,
    );
    const listTool = (
      tools.message?.result?.['tools'] as Array<{
        name: string;
        description: string;
        inputSchema: { properties?: Record<string, unknown> };
      }>
    ).find((t) => t.name === 'listBookmarks');
    expect(listTool?.description).toContain('M11/M12/M14/M17/M18 operator grammar');
    expect(listTool?.inputSchema.properties?.['q']).toBeDefined();

    const ok = await mcpPost(
      baseUrl,
      patToken,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'listBookmarks',
          arguments: { q: '#Rust type:video file:false' },
        },
      },
      sessionId,
    );
    expect(ok.status).toBe(200);
    expect(ok.message?.error).toBeUndefined();
    expect(ok.message?.result?.['isError']).toBeUndefined();
    const items = (ok.message?.result?.['structuredContent'] as { items: Array<{ id: string }> })
      .items;
    expect(items.map((i) => i.id)).toEqual([ids.tokioVideo!]);

    const invalid = await mcpPost(
      baseUrl,
      patToken,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'listBookmarks',
          arguments: { search: 'file:bogus' },
        },
      },
      sessionId,
    );
    expect(invalid.status).toBe(200);
    expect(invalid.message?.result?.['isError']).toBe(true);
    expect((invalid.message?.result?.['content'] as Array<{ text: string }>)[0]?.text).toContain(
      '400',
    );
  });
});
