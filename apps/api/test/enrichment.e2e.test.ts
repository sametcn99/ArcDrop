import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { TrashPurgeService } from '../src/bookmarks/trash-purge.service';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { installTestEnv } from './helpers';

/**
 * M10 — Bookmark enrichment (highlights, favorites, content types, quick-add).
 *
 * Covers:
 * - Highlights CRUD (D6), validation, cross-user 404 isolation
 * - Trash keeps highlights; restore keeps them mutable; purge cascades & emits tombstones
 * - M5 `/sync/changes` serves `HighlightSnapshotDto` + tombstones for `entity: 'highlight'`
 * - Favorites toggle, `favorite=true|false` filter composition, `stats.favorites`, 404 on unknown id
 * - Quick-add (`POST /bookmarks?url=…&collection=…`) field-by-field parity with JSON body,
 *   D13 duplicates allowed, collection attachment by title & uuid, error cases
 * - OpenAPI operationIds & sync entity enum coverage
 */

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

interface BookmarkView {
  id: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  note: string | null;
  favorite: boolean;
  contentType: string;
  coverRef: string | null;
  iconRef: string | null;
  urlParts: {
    scheme: string;
    host: string;
    domain: string | null;
    port: string | null;
    path: string;
    query: string | null;
    fragment: string | null;
  };
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

interface HighlightView {
  id: string;
  bookmarkId: string;
  text: string;
  note: string | null;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StatsView {
  total: number;
  unassigned: number;
  trashed: number;
  favorites: number;
}

interface SyncChangesView {
  resyncRequired: boolean;
  changes: Array<{
    seq: string;
    entity: string;
    id: string;
    action: string;
    snapshot: Record<string, unknown> | null;
  }>;
  cursor: string;
}

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

describe('Bookmark enrichment — M10 (e2e)', () => {
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
    alice = await createUserViaAdmin(baseUrl, admin, 'alice-m10@arcdrop.test');
    bob = await createUserViaAdmin(baseUrl, admin, 'bob-m10@arcdrop.test');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('OpenAPI exposes M10 operationIds and highlight entity in SyncChangeDto', async () => {
    const res = await fetch(`${baseUrl}/openapi.json`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: {
        schemas: Record<string, { properties?: Record<string, { enum?: string[] }> }>;
      };
    };

    expect(doc.paths['/api/v1/bookmarks/{id}/highlights']?.get?.operationId).toBe('listHighlights');
    expect(doc.paths['/api/v1/bookmarks/{id}/highlights']?.post?.operationId).toBe(
      'createHighlight',
    );
    expect(doc.paths['/api/v1/highlights/{id}']?.put?.operationId).toBe('updateHighlight');
    expect(doc.paths['/api/v1/highlights/{id}']?.delete?.operationId).toBe('deleteHighlight');

    const syncChangeSchema = doc.components.schemas['SyncChangeDto'];
    expect(syncChangeSchema?.properties?.['entity']?.enum).toContain('highlight');
  });

  it('Highlights (D6): CRUD, validation, cross-user isolation, and M5 sync snapshots', async () => {
    const bm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://articles.example/deep-dive', title: 'Deep Dive' },
    });
    expect(bm.status).toBe(201);

    const stateBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });

    // Create with surrounding whitespace + color + note
    const c1 = await call<HighlightView>(baseUrl, 'POST', `/bookmarks/${bm.body.id}/highlights`, {
      bearer: alice.accessToken,
      body: { text: '  First key quote  ', note: '  Important  ', color: 'yellow' },
    });
    expect(c1.status).toBe(201);
    expect(c1.body.bookmarkId).toBe(bm.body.id);
    expect(c1.body.text).toBe('First key quote');
    expect(c1.body.note).toBe('Important');
    expect(c1.body.color).toBe('yellow');

    const c2 = await call<HighlightView>(baseUrl, 'POST', `/bookmarks/${bm.body.id}/highlights`, {
      bearer: alice.accessToken,
      body: { text: 'Second quote' },
    });
    expect(c2.status).toBe(201);
    expect(c2.body.note).toBeNull();
    expect(c2.body.color).toBeNull();

    // Validation errors: empty / whitespace text
    const emptyText = await call(baseUrl, 'POST', `/bookmarks/${bm.body.id}/highlights`, {
      bearer: alice.accessToken,
      body: { text: '' },
    });
    expect(emptyText.status).toBe(400);
    expect(problem(emptyText).code).toBe('VALIDATION_FAILED');

    const blankText = await call(baseUrl, 'POST', `/bookmarks/${bm.body.id}/highlights`, {
      bearer: alice.accessToken,
      body: { text: '   ' },
    });
    expect(blankText.status).toBe(400);
    expect(problem(blankText).code).toBe('BAD_REQUEST');

    // List ordered chronologically
    const listed = await call<{ items: HighlightView[] }>(
      baseUrl,
      'GET',
      `/bookmarks/${bm.body.id}/highlights`,
      { bearer: alice.accessToken },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((h) => h.id)).toEqual([c1.body.id, c2.body.id]);

    // Cross-user isolation: bob sees 404 everywhere
    expect(
      (
        await call(baseUrl, 'GET', `/bookmarks/${bm.body.id}/highlights`, {
          bearer: bob.accessToken,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(baseUrl, 'POST', `/bookmarks/${bm.body.id}/highlights`, {
          bearer: bob.accessToken,
          body: { text: 'Hijack' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(baseUrl, 'PUT', `/highlights/${c1.body.id}`, {
          bearer: bob.accessToken,
          body: { note: 'Hijacked' },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(baseUrl, 'DELETE', `/highlights/${c1.body.id}`, { bearer: bob.accessToken }))
        .status,
    ).toBe(404);

    // Update: clear note with null, update color & text
    const updated = await call<HighlightView>(baseUrl, 'PUT', `/highlights/${c1.body.id}`, {
      bearer: alice.accessToken,
      body: { text: 'Edited quote', note: null, color: 'blue' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.text).toBe('Edited quote');
    expect(updated.body.note).toBeNull();
    expect(updated.body.color).toBe('blue');

    // Delete second highlight
    const del = await call(baseUrl, 'DELETE', `/highlights/${c2.body.id}`, {
      bearer: alice.accessToken,
    });
    expect(del.status).toBe(204);

    // Sync changes serve HighlightSnapshotDto + tombstone
    const delta = await call<SyncChangesView>(
      baseUrl,
      'GET',
      `/sync/changes?since=${stateBefore.body.seq}&limit=50`,
      { bearer: alice.accessToken },
    );
    expect(delta.status).toBe(200);
    const hlEvents = delta.body.changes.filter((c) => c.entity === 'highlight');
    expect(hlEvents.map((e) => ({ action: e.action, id: e.id }))).toEqual([
      { action: 'create', id: c1.body.id },
      { action: 'create', id: c2.body.id },
      { action: 'update', id: c1.body.id },
      { action: 'delete', id: c2.body.id },
    ]);
    expect(hlEvents[0]!.snapshot).toMatchObject({
      id: c1.body.id,
      bookmarkId: bm.body.id,
      text: 'Edited quote',
    });
    expect(hlEvents[3]!.snapshot).toBeNull(); // delete tombstone
  });

  it('Highlights lifecycle: trash preserves, restore re-enables mutations, purge cascades with tombstones', async () => {
    const bm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://lifecycle.example/post', title: 'Lifecycle' },
    });
    const hl = await call<HighlightView>(baseUrl, 'POST', `/bookmarks/${bm.body.id}/highlights`, {
      bearer: alice.accessToken,
      body: { text: 'Survives trash', note: 'Keep me' },
    });
    expect(hl.status).toBe(201);

    // Trash the bookmark
    const trashed = await call(baseUrl, 'DELETE', `/bookmarks/${bm.body.id}`, {
      bearer: alice.accessToken,
    });
    expect(trashed.status).toBe(204);

    // Reads still see the highlight while trashed
    const whileTrashed = await call<{ items: HighlightView[] }>(
      baseUrl,
      'GET',
      `/bookmarks/${bm.body.id}/highlights`,
      { bearer: alice.accessToken },
    );
    expect(whileTrashed.status).toBe(200);
    expect(whileTrashed.body.items).toHaveLength(1);
    expect(whileTrashed.body.items[0]!.id).toBe(hl.body.id);

    // Mutations are refused while trashed (404)
    expect(
      (
        await call(baseUrl, 'POST', `/bookmarks/${bm.body.id}/highlights`, {
          bearer: alice.accessToken,
          body: { text: 'Cannot add while trashed' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(baseUrl, 'PUT', `/highlights/${hl.body.id}`, {
          bearer: alice.accessToken,
          body: { note: 'Cannot edit' },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(baseUrl, 'DELETE', `/highlights/${hl.body.id}`, { bearer: alice.accessToken }))
        .status,
    ).toBe(404);

    // Restore brings it back and re-enables mutations
    const restored = await call(baseUrl, 'POST', `/bookmarks/${bm.body.id}/restore`, {
      bearer: alice.accessToken,
    });
    expect(restored.status).toBe(200);

    const edited = await call<HighlightView>(baseUrl, 'PUT', `/highlights/${hl.body.id}`, {
      bearer: alice.accessToken,
      body: { note: 'Restored and editable' },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.note).toBe('Restored and editable');

    // Trash again, backdate beyond retention, and run purge
    await call(baseUrl, 'DELETE', `/bookmarks/${bm.body.id}`, { bearer: alice.accessToken });
    await dataSource.query(
      `UPDATE bookmarks SET deleted_at = NOW() - INTERVAL '400 days' WHERE id = $1`,
      [bm.body.id],
    );
    const seqBeforePurge = (
      await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
    ).body.seq;

    const purgeResult = await app.get(TrashPurgeService).purgeExpired();
    expect(purgeResult.purged).toBeGreaterThanOrEqual(1);

    // Highlight row cascaded away
    const rows = (await dataSource.query('SELECT id FROM highlights WHERE id = $1', [
      hl.body.id,
    ])) as Array<{ id: string }>;
    expect(rows).toHaveLength(0);

    // Purge emitted highlight:delete and bookmark:delete tombstones
    const purgeDelta = await call<SyncChangesView>(
      baseUrl,
      'GET',
      `/sync/changes?since=${seqBeforePurge}&limit=50`,
      { bearer: alice.accessToken },
    );
    expect(purgeDelta.body.changes).toContainEqual({
      seq: expect.any(String),
      entity: 'highlight',
      id: hl.body.id,
      action: 'delete',
      snapshot: null,
    });
    expect(purgeDelta.body.changes).toContainEqual({
      seq: expect.any(String),
      entity: 'bookmark',
      id: bm.body.id,
      action: 'delete',
      snapshot: null,
    });
  });

  it('Favorites: toggle, favorite=true|false filter composition, stats.favorites, and 404 on unknown id', async () => {
    await wipeData(dataSource);
    admin = await bootstrapAdmin(baseUrl);
    alice = await createUserViaAdmin(baseUrl, admin, 'alice-fav@arcdrop.test');
    bob = await createUserViaAdmin(baseUrl, admin, 'bob-fav@arcdrop.test');

    const b1 = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://news.ycombinator.com/item?id=1', title: 'HN Thread' },
    });
    const b2 = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://www.youtube.com/watch?v=abc', title: 'Talk', favorite: true },
    });
    expect(b1.body.favorite).toBe(false);
    expect(b2.body.favorite).toBe(true);
    expect(b2.body.contentType).toBe('link'); // stays 'link' until M6 pipeline classifies

    await call(baseUrl, 'PUT', `/bookmarks/${b1.body.id}/tags`, {
      bearer: alice.accessToken,
      body: { tags: ['dev'] },
    });
    await call(baseUrl, 'PUT', `/bookmarks/${b2.body.id}/tags`, {
      bearer: alice.accessToken,
      body: { tags: ['dev'] },
    });

    // Toggle b1 -> favorite: true
    const seqBefore = (
      await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
    ).body.seq;
    const toggled = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${b1.body.id}`, {
      bearer: alice.accessToken,
      body: { favorite: true },
    });
    expect(toggled.status).toBe(200);
    expect(toggled.body.favorite).toBe(true);

    const delta = await call<SyncChangesView>(baseUrl, 'GET', `/sync/changes?since=${seqBefore}`, {
      bearer: alice.accessToken,
    });
    expect(delta.body.changes).toHaveLength(1);
    expect(delta.body.changes[0]).toMatchObject({
      entity: 'bookmark',
      action: 'update',
      id: b1.body.id,
    });
    expect(delta.body.changes[0]!.snapshot?.['favorite']).toBe(true);

    // Unknown id -> 404
    const missing = await call(baseUrl, 'PUT', '/bookmarks/00000000-0000-4000-8000-000000000000', {
      bearer: alice.accessToken,
      body: { favorite: true },
    });
    expect(missing.status).toBe(404);

    // Stats reflect 2 favorites
    let stats = await call<StatsView>(baseUrl, 'GET', '/bookmarks/stats', {
      bearer: alice.accessToken,
    });
    expect(stats.status).toBe(200);
    expect(stats.body).toEqual({ total: 2, unassigned: 2, trashed: 0, favorites: 2 });

    // Un-star b1
    const unstarred = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${b1.body.id}`, {
      bearer: alice.accessToken,
      body: { favorite: false },
    });
    expect(unstarred.body.favorite).toBe(false);

    stats = await call<StatsView>(baseUrl, 'GET', '/bookmarks/stats', {
      bearer: alice.accessToken,
    });
    expect(stats.body.favorites).toBe(1);

    // Filter composition: favorite=true & tag=dev & type=link & domain=youtube.com
    const favOnly = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?favorite=true', {
      bearer: alice.accessToken,
    });
    expect(favOnly.body.items.map((b) => b.id)).toEqual([b2.body.id]);

    const nonFavOnly = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?favorite=false', {
      bearer: alice.accessToken,
    });
    expect(nonFavOnly.body.items.map((b) => b.id)).toEqual([b1.body.id]);

    const composed = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?favorite=true&tag=dev&type=link&domain=youtube.com',
      { bearer: alice.accessToken },
    );
    expect(composed.body.items.map((b) => b.id)).toEqual([b2.body.id]);

    // Trashing favorite decrements active stats.favorites
    await call(baseUrl, 'DELETE', `/bookmarks/${b2.body.id}`, { bearer: alice.accessToken });
    stats = await call<StatsView>(baseUrl, 'GET', '/bookmarks/stats', {
      bearer: alice.accessToken,
    });
    expect(stats.body).toEqual({ total: 1, unassigned: 1, trashed: 1, favorites: 0 });
  });

  it('Quick-add: query params create field-by-field identical bookmark to JSON body, allow duplicates (D13), and attach collection', async () => {
    const col = await call<{ id: string; title: string }>(baseUrl, 'POST', '/collections', {
      bearer: alice.accessToken,
      body: { title: 'Reading List' },
    });
    expect(col.status).toBe(201);

    const payload = {
      url: 'https://docs.arcdrop.dev/quick-add?ref=rss#top',
      title: 'Quick Add Guide',
      excerpt: 'Summary text',
      note: 'Read on weekend',
      favorite: true,
    };

    // 1. JSON body create
    const fromJson = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: payload,
    });
    expect(fromJson.status).toBe(201);

    // 2. Quick-add via query params (same URL -> D13 duplicate allowed)
    const qs = new URLSearchParams({
      url: payload.url,
      title: payload.title,
      excerpt: payload.excerpt,
      note: payload.note,
      favorite: 'true',
      collection: 'Reading List',
    });
    const seqBeforeQuick = (
      await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', { bearer: alice.accessToken })
    ).body.seq;

    const fromQuery = await call<BookmarkView>(baseUrl, 'POST', `/bookmarks?${qs.toString()}`, {
      bearer: alice.accessToken,
    });
    expect(fromQuery.status).toBe(201);
    expect(fromQuery.body.id).not.toBe(fromJson.body.id);

    // Compare field-by-field (ignoring generated id & server timestamps)
    const normalize = (b: BookmarkView) => ({
      url: b.url,
      title: b.title,
      excerpt: b.excerpt,
      note: b.note,
      favorite: b.favorite,
      contentType: b.contentType,
      coverRef: b.coverRef,
      iconRef: b.iconRef,
      urlParts: b.urlParts,
      tags: b.tags,
      deletedAt: b.deletedAt,
    });
    expect(normalize(fromQuery.body)).toEqual(normalize(fromJson.body));

    // Membership in 'Reading List' attached and sync events emitted
    const inCol = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?collectionId=${col.body.id}`,
      { bearer: alice.accessToken },
    );
    expect(inCol.body.items.map((b) => b.id)).toEqual([fromQuery.body.id]);

    const quickDelta = await call<SyncChangesView>(
      baseUrl,
      'GET',
      `/sync/changes?since=${seqBeforeQuick}`,
      { bearer: alice.accessToken },
    );
    expect(quickDelta.body.changes.map((c) => ({ entity: c.entity, action: c.action }))).toEqual([
      { entity: 'bookmark', action: 'create' },
      { entity: 'collection', action: 'update' },
    ]);

    // Quick-add by collection UUID also works
    const byUuid = await call<BookmarkView>(
      baseUrl,
      'POST',
      `/bookmarks?url=${encodeURIComponent('https://example.org/uuid')}&collection=${col.body.id}`,
      { bearer: alice.accessToken },
    );
    expect(byUuid.status).toBe(201);

    // Validation & refusal cases
    const missingUrl = await call(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: {},
    });
    expect(missingUrl.status).toBe(400);
    expect(problem(missingUrl).code).toBe('VALIDATION_FAILED');

    const unknownCollection = await call(
      baseUrl,
      'POST',
      `/bookmarks?url=${encodeURIComponent('https://example.org/missing-col')}&collection=NonExistent`,
      { bearer: alice.accessToken },
    );
    expect(unknownCollection.status).toBe(404);
  });
});
