import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { createDataSource } from '../src/database/data-source';
import { loadConfig } from '../src/config/load-config';
import { TrashPurgeService } from '../src/bookmarks/trash-purge.service';
import { installTestEnv } from './helpers';

/**
 * M3 bookmarks core e2e (plan D4/D5/D12/D13/D17) — real HTTP against real
 * Postgres. Boot A drives the lifecycle: create → search → update url →
 * trash → restore → purge, tags (case-merge/rename/delete), stats, the
 * change-log contract (gapless per-user seq incl. a concurrent-create test)
 * and user isolation. Boot B is an isolated rate-limit bucket for the
 * search/paging/sort grid and validation garbage.
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

interface UrlPartsView {
  scheme: string;
  host: string;
  domain: string | null;
  port: string | null;
  path: string;
  query: string | null;
  fragment: string | null;
}

interface TagView {
  id: string;
  name: string;
}

interface BookmarkView {
  id: string;
  url: string;
  title: string | null;
  excerpt: string | null;
  note: string | null;
  coverRef: string | null;
  iconRef: string | null;
  urlParts: UrlPartsView;
  tags: TagView[];
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

interface StatsView {
  total: number;
  unassigned: number;
  trashed: number;
}

interface TagUsageView {
  id: string;
  name: string;
  count: number;
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

describe('Bookmarks core (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  describe('boot A — full lifecycle', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let bob: AuthSession;

    beforeAll(async () => {
      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      bob = await createUserViaAdmin(baseUrl, admin, 'bob@arcdrop.test');
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('rejects unauthenticated access with problem+json', async () => {
      const res = await call(baseUrl, 'GET', '/bookmarks');
      expect(res.status).toBe(401);
      expect(res.contentType).toContain('application/problem+json');
      expect(problem(res).code).toBe('UNAUTHORIZED');
    });

    it('creates a bookmark, stores the url verbatim, derives the parts (D12)', async () => {
      const url = 'HTTPS://Docs.Example.com:8443/guide/Latest?page=2&lang=en#setup';
      const res = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url, title: 'ArcDrop Guide', excerpt: 'How to deploy', note: 'reread ch. 2' },
      });
      expect(res.status).toBe(201);
      const row = res.body;
      expect(row.url).toBe(url); // verbatim — case and all
      expect(row.urlParts).toEqual({
        scheme: 'https',
        host: 'docs.example.com',
        domain: 'example.com',
        port: '8443',
        path: '/guide/Latest',
        query: 'page=2&lang=en',
        fragment: 'setup',
      });
      expect(row.tags).toEqual([]);
      expect(row.coverRef).toBeNull();
      expect(row.iconRef).toBeNull();
      expect(row.deletedAt).toBeNull();

      // Cross-check the derived columns in storage.
      const stored = await dataSource.query(
        'SELECT scheme, host, domain, port, path, query, fragment FROM bookmarks WHERE id = $1',
        [row.id],
      );
      expect(stored[0]).toEqual({
        scheme: 'https',
        host: 'docs.example.com',
        domain: 'example.com',
        port: '8443',
        path: '/guide/Latest',
        query: 'page=2&lang=en',
        fragment: 'setup',
      });
    });

    it('allows duplicate urls — two rows, both visible (D13)', async () => {
      const url = 'https://duplicate.example.com/article';
      const first = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url, title: 'first copy' },
      });
      const second = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url, title: 'second copy' },
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.id).not.toBe(second.body.id);

      const list = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?search=${encodeURIComponent('duplicate.example.com')}`,
        { bearer: admin.accessToken },
      );
      expect(list.body.totalCount).toBe(2);
      expect(list.body.items.map((item) => item.title).sort()).toEqual([
        'first copy',
        'second copy',
      ]);
    });

    it('rejects an invalid url with a 400 problem', async () => {
      const res = await call(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'not-a-url' },
      });
      expect(res.status).toBe(400);
      expect(problem(res).code).toBe('BAD_REQUEST');
      expect(res.contentType).toContain('application/problem+json');
    });

    it('runs the AC cycle: search → update url (parts recomputed) → trash → restore', async () => {
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: {
          url: 'https://wiki.longboard.dev/setup-wheels',
          title: 'Longboard Wheel Setup',
          excerpt: 'Bearing maintenance for beginners',
        },
      });
      expect(created.status).toBe(201);
      const id = created.body.id;

      // -- search by title (case-insensitive) --
      const byTitle = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?search=${encodeURIComponent('LONGBOARD')}`,
        { bearer: admin.accessToken },
      );
      expect(byTitle.body.totalCount).toBe(1);
      expect(byTitle.body.items[0]!.id).toBe(id);

      // -- search by url substring --
      const byUrl = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?search=${encodeURIComponent('setup-wheels')}`,
        { bearer: admin.accessToken },
      );
      expect(byUrl.body.totalCount).toBe(1);

      // -- tag it, then search by tag name --
      const tagged = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${id}/tags`, {
        bearer: admin.accessToken,
        body: { tags: ['Maintenance'] },
      });
      expect(tagged.status).toBe(200);
      expect(tagged.body.tags.map((tag) => tag.name)).toEqual(['Maintenance']);

      const byTag = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?tag=${encodeURIComponent('maintenance')}`, // case-insensitive filter
        { bearer: admin.accessToken },
      );
      expect(byTag.body.totalCount).toBe(1);
      expect(byTag.body.items[0]!.id).toBe(id);

      // -- update the url: parts recomputed, url verbatim --
      const newUrl = 'http://10.0.0.7:9000/local-setup#anchor-3';
      const updated = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${id}`, {
        bearer: admin.accessToken,
        body: { url: newUrl },
      });
      expect(updated.status).toBe(200);
      expect(updated.body.url).toBe(newUrl);
      expect(updated.body.urlParts).toEqual({
        scheme: 'http',
        host: '10.0.0.7',
        domain: null, // IP host has no registrable domain
        port: '9000',
        path: '/local-setup',
        query: null,
        fragment: 'anchor-3',
      });
      expect(updated.body.tags.map((tag) => tag.name)).toEqual(['Maintenance']); // url change keeps tags

      // -- trash: leaves the active set, enters the trash --
      const trashed = await call(baseUrl, 'DELETE', `/bookmarks/${id}`, {
        bearer: admin.accessToken,
      });
      expect(trashed.status).toBe(204);

      const activeList = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks', {
        bearer: admin.accessToken,
      });
      expect(activeList.body.items.find((item) => item.id === id)).toBeUndefined();

      const trashList = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?trashed=true', {
        bearer: admin.accessToken,
      });
      const trashedRow = trashList.body.items.find((item) => item.id === id);
      expect(trashedRow).toBeDefined();
      expect(trashedRow!.deletedAt).not.toBeNull();

      // GET by id still works in the trash; PUT does not.
      const inTrash = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${id}`, {
        bearer: admin.accessToken,
      });
      expect(inTrash.status).toBe(200);
      expect(inTrash.body.deletedAt).not.toBeNull();
      const putInTrash = await call(baseUrl, 'PUT', `/bookmarks/${id}`, {
        bearer: admin.accessToken,
        body: { title: 'nope' },
      });
      expect(putInTrash.status).toBe(404);

      // -- restore: back to the active set --
      const restored = await call<BookmarkView>(baseUrl, 'POST', `/bookmarks/${id}/restore`, {
        bearer: admin.accessToken,
      });
      expect(restored.status).toBe(200);
      expect(restored.body.deletedAt).toBeNull();
      const backActive = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks', {
        bearer: admin.accessToken,
      });
      expect(backActive.body.items.find((item) => item.id === id)).toBeDefined();
    });

    it('merges same-tag-different-case into one tag; renames re-point; records changes (AC)', async () => {
      const a = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://books.example.com/moby-dick', title: 'Moby Dick' },
      });
      const b = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: {
          url: 'https://books.example.com/moby-dick-analysis',
          title: 'Moby Dick — Analysis',
        },
      });

      // Same tag, two spellings, one bookmark → ONE tag.
      const merged = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${a.body.id}/tags`, {
        bearer: admin.accessToken,
        body: { tags: ['Novels', 'novels', 'Novels'] },
      });
      expect(merged.status).toBe(200);
      expect(merged.body.tags.map((tag) => tag.name)).toEqual(['Novels']);

      const usage = await call<TagUsageView[]>(baseUrl, 'GET', '/bookmarks/tags', {
        bearer: admin.accessToken,
      });
      const novelsRow = usage.body.find((tag) => tag.name.toLowerCase() === 'novels');
      expect(novelsRow).toBeDefined();
      expect(usage.body.filter((tag) => tag.name.toLowerCase() === 'novels')).toHaveLength(1);
      expect(novelsRow!.count).toBe(1);

      // Tag the second bookmark with 'novels' (lowercase) — same tag.
      const tagB = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${b.body.id}/tags`, {
        bearer: admin.accessToken,
        body: { tags: ['novels'] },
      });
      expect(tagB.body.tags.map((tag) => tag.name)).toEqual(['Novels']); // first spelling wins
      expect(tagB.body.tags[0]!.id).toBe(novelsRow!.id);

      // RENAME novels → fiction: both bookmarks re-pointed, change recorded.
      const renamed = await call<TagView>(baseUrl, 'PUT', `/tags/${encodeURIComponent('novels')}`, {
        bearer: admin.accessToken,
        body: { name: 'fiction' },
      });
      expect(renamed.status).toBe(200);
      const renamedUsage = await call<TagUsageView[]>(baseUrl, 'GET', '/bookmarks/tags', {
        bearer: admin.accessToken,
      });
      expect(renamedUsage.body.find((tag) => tag.name === 'fiction')?.count).toBe(2);
      expect(renamedUsage.body.find((tag) => tag.name.toLowerCase() === 'novels')).toBeUndefined();

      const gotA = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${a.body.id}`, {
        bearer: admin.accessToken,
      });
      expect(gotA.body.tags.map((tag) => tag.name)).toEqual(['fiction']);

      // Merge fiction into a new existing tag: create 'reading' on B first,
      // then merge → A keeps fiction? No: fiction DIES, memberships move to reading.
      await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${b.body.id}/tags`, {
        bearer: admin.accessToken,
        body: { tags: ['fiction', 'reading'] },
      });
      const merge = await call<TagView>(baseUrl, 'PUT', `/tags/${encodeURIComponent('fiction')}`, {
        bearer: admin.accessToken,
        body: { name: 'reading' },
      });
      expect(merge.status).toBe(200);
      expect(merge.body.name).toBe('reading');

      const afterMergeA = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${a.body.id}`, {
        bearer: admin.accessToken,
      });
      expect(afterMergeA.body.tags.map((tag) => tag.name)).toEqual(['reading']);
      const afterMergeB = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${b.body.id}`, {
        bearer: admin.accessToken,
      });
      expect(afterMergeB.body.tags.map((tag) => tag.name).sort()).toEqual(['reading']);

      const finalUsage = await call<TagUsageView[]>(baseUrl, 'GET', '/bookmarks/tags', {
        bearer: admin.accessToken,
      });
      // 'Maintenance' survives from the AC-cycle bookmark; the merged pair
      // is one 'reading' tag with both bookmarks. Sorted by name.
      expect(finalUsage.body.map((tag) => tag.name)).toEqual(['Maintenance', 'reading']);
      expect(finalUsage.body[1]!.count).toBe(2);

      // Change log recorded the tag lifecycle: create (on demand) → update
      // (rename) → delete (merge). Filter to tag-entity events for A's user.
      const tagEvents = (await eventsFor(dataSource, admin.user.id)).filter(
        (row) => row.entity === 'tag',
      );
      const actions = tagEvents.map((row) => row.action);
      expect(actions).toContain('create');
      expect(actions).toContain('update');
      expect(actions).toContain('delete');
    });

    it('deleting a tag detaches it everywhere and prunes it', async () => {
      const row = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://temp.example.com/throwaway', title: 'Throwaway' },
      });
      const tagged = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${row.body.id}/tags`, {
        bearer: admin.accessToken,
        body: { tags: ['ephemeral'] },
      });
      expect(tagged.body.tags).toHaveLength(1);

      const del = await call(baseUrl, 'DELETE', `/tags/${encodeURIComponent('ephemeral')}`, {
        bearer: admin.accessToken,
      });
      expect(del.status).toBe(204);

      const usage = await call<TagUsageView[]>(baseUrl, 'GET', '/bookmarks/tags', {
        bearer: admin.accessToken,
      });
      expect(usage.body.find((tag) => tag.name === 'ephemeral')).toBeUndefined();

      const got = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${row.body.id}`, {
        bearer: admin.accessToken,
      });
      expect(got.body.tags).toEqual([]);
    });

    it('exact-set replacement removes dropped tags and prunes them', async () => {
      const row = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://tags.example.com/replace-me', title: 'Replace me' },
      });
      const id = row.body.id;
      await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${id}/tags`, {
        bearer: admin.accessToken,
        body: { tags: ['one', 'two'] },
      });
      const replaced = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${id}/tags`, {
        bearer: admin.accessToken,
        body: { tags: ['two', 'three'] },
      });
      expect(replaced.body.tags.map((tag) => tag.name).sort()).toEqual(['three', 'two']);

      const usage = await call<TagUsageView[]>(baseUrl, 'GET', '/bookmarks/tags', {
        bearer: admin.accessToken,
      });
      const names = usage.body.map((tag) => tag.name);
      expect(names).not.toContain('one'); // pruned
      expect(names).toContain('two');
      expect(names).toContain('three');
    });

    it('records exactly one event per single-entity mutation with gapless seqs', async () => {
      // Isolate: remember where the log stands.
      const before = (await eventsFor(dataSource, admin.user.id)).length;

      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://sequence.example.com/one', title: 'Sequence one' },
      });
      const updated = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${created.body.id}`, {
        bearer: admin.accessToken,
        body: { title: 'Sequence one (edited)' },
      });
      const trashed = await call(baseUrl, 'DELETE', `/bookmarks/${created.body.id}`, {
        bearer: admin.accessToken,
      });
      const restored = await call(baseUrl, 'POST', `/bookmarks/${created.body.id}/restore`, {
        bearer: admin.accessToken,
      });
      expect(updated.status).toBe(200);
      expect(trashed.status).toBe(204);
      expect(restored.status).toBe(200);

      const events = await eventsFor(dataSource, admin.user.id);
      const slice = events.slice(before);
      expect(slice).toHaveLength(4);
      expect(slice.map((row) => row.action)).toEqual(['create', 'update', 'update', 'update']);
      expect(slice.every((row) => row.entity === 'bookmark')).toBe(true);
      const seqs = slice.map((row) => Number(row.seq));
      expect(seqs).toEqual([seqs[0]!, seqs[0]! + 1, seqs[0]! + 2, seqs[0]! + 3]);
    });

    it('survives a concurrent create burst with a gapless per-user seq (AC)', async () => {
      const before = await eventsFor(dataSource, admin.user.id);
      const maxBefore = before.length > 0 ? Number(before[before.length - 1]!.seq) : 0;

      const BURST = 8;
      const responses = await Promise.all(
        Array.from({ length: BURST }, (_, i) =>
          call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
            bearer: admin.accessToken,
            body: { url: `https://burst.example.com/${i}`, title: `Burst ${i}` },
          }),
        ),
      );
      expect(responses.every((res) => res.status === 201)).toBe(true);

      const after = await eventsFor(dataSource, admin.user.id);
      const burst = after.slice(maxBefore).filter((row) => row.action === 'create');
      expect(burst).toHaveLength(BURST);

      const seqs = burst.map((row) => Number(row.seq));
      expect([...seqs].sort((a, b) => a - b)).toEqual(
        Array.from({ length: BURST }, (_, i) => maxBefore + 1 + i),
      );

      // And the users.sync_seq counter matches the event count exactly.
      const counters = await dataSource.query('SELECT sync_seq FROM users WHERE id = $1', [
        admin.user.id,
      ]);
      expect(Number(counters[0]!.sync_seq)).toBe(after.length);
    });

    it('is scoped per user — another user gets 404 and an empty list', async () => {
      const mine = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://private.example.com/admins-only', title: 'Admins only' },
      });

      const forbidden = await call(baseUrl, 'GET', `/bookmarks/${mine.body.id}`, {
        bearer: bob.accessToken,
      });
      expect(forbidden.status).toBe(404);
      expect(problem(forbidden).code).toBe('NOT_FOUND');

      const blindUpdate = await call(baseUrl, 'PUT', `/bookmarks/${mine.body.id}`, {
        bearer: bob.accessToken,
        body: { title: 'stolen' },
      });
      expect(blindUpdate.status).toBe(404);

      const blindDelete = await call(baseUrl, 'DELETE', `/bookmarks/${mine.body.id}`, {
        bearer: bob.accessToken,
      });
      expect(blindDelete.status).toBe(404);

      const bobList = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks', {
        bearer: bob.accessToken,
      });
      expect(bobList.body.totalCount).toBe(0);

      // bob's tags are empty too — tags are per-user.
      const bobTags = await call<TagUsageView[]>(baseUrl, 'GET', '/bookmarks/tags', {
        bearer: bob.accessToken,
      });
      expect(bobTags.body).toEqual([]);
    });

    it('reports stats: total / unassigned / trashed', async () => {
      const keep = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://stats.example.com/keeper', title: 'Keeper' },
      });
      const doomed = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://stats.example.com/doomed', title: 'Doomed' },
      });
      await call(baseUrl, 'DELETE', `/bookmarks/${doomed.body.id}`, { bearer: admin.accessToken });

      const stats = await call<StatsView>(baseUrl, 'GET', '/bookmarks/stats', {
        bearer: admin.accessToken,
      });
      expect(stats.status).toBe(200);
      expect(stats.body.total).toBeGreaterThan(0);
      expect(stats.body.trashed).toBe(1);
      expect(stats.body.unassigned).toBe(stats.body.total); // no collections before M4

      await call(baseUrl, 'DELETE', `/bookmarks/${keep.body.id}`, { bearer: admin.accessToken });
      const afterTrash = await call<StatsView>(baseUrl, 'GET', '/bookmarks/stats', {
        bearer: admin.accessToken,
      });
      expect(afterTrash.body.trashed).toBe(2);
    });

    it('purges expired trash honoring trashRetentionDays; purge emits delete events (AC)', async () => {
      // The API clamps retention to ≥1 day (D16), so "expired" is simulated
      // by backdating the trash time of a bookmark under a 1-day retention.
      const setShort = await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { trashRetentionDays: 1 },
      });
      expect(setShort.status).toBe(200);

      const eventsBefore = await eventsFor(dataSource, admin.user.id);

      const victim = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://purge.example.com/victim', title: 'Victim' },
      });
      const survivor = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://purge.example.com/survivor', title: 'Survivor (active)' },
      });
      await call(baseUrl, 'DELETE', `/bookmarks/${victim.body.id}`, { bearer: admin.accessToken });

      // Age the victim's trash beyond the 1-day window (3 days old).
      await dataSource.query(
        `UPDATE bookmarks SET deleted_at = now() - interval '3 days' WHERE id = $1`,
        [victim.body.id],
      );

      const purge = app.get(TrashPurgeService);
      const summary = await purge.purgeExpired();
      expect(summary.purged).toBe(1);

      // The victim is GONE — not in trash, not restorable, not in the DB.
      const gone = await call(baseUrl, 'GET', `/bookmarks/${victim.body.id}`, {
        bearer: admin.accessToken,
      });
      expect(gone.status).toBe(404);
      const restoreGone = await call(baseUrl, 'POST', `/bookmarks/${victim.body.id}/restore`, {
        bearer: admin.accessToken,
      });
      expect(restoreGone.status).toBe(404);
      const rows = await dataSource.query('SELECT id FROM bookmarks WHERE id = $1', [
        victim.body.id,
      ]);
      expect(rows).toHaveLength(0);

      // The active survivor was untouched.
      const stillThere = await call<BookmarkView>(
        baseUrl,
        'GET',
        `/bookmarks/${survivor.body.id}`,
        {
          bearer: admin.accessToken,
        },
      );
      expect(stillThere.status).toBe(200);

      // Purge emitted a tombstone for exactly the purged bookmark.
      const eventsAfter = await eventsFor(dataSource, admin.user.id);
      const newDeletes = eventsAfter
        .slice(eventsBefore.length)
        .filter((row) => row.action === 'delete');
      expect(newDeletes.length).toBeGreaterThanOrEqual(1);
      expect(newDeletes.some((row) => row.entity_id === victim.body.id)).toBe(true);

      // Under the default 30-day window a fresh trashed bookmark survives a purge.
      await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { trashRetentionDays: 30 },
      });
      const fresh = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://purge.example.com/fresh-trash', title: 'Fresh trash' },
      });
      await call(baseUrl, 'DELETE', `/bookmarks/${fresh.body.id}`, { bearer: admin.accessToken });
      const secondPurge = await purge.purgeExpired();
      expect(secondPurge.purged).toBe(0); // nothing is 30 days old
      const freshStill = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${fresh.body.id}`, {
        bearer: admin.accessToken,
      });
      expect(freshStill.status).toBe(200);
      expect(freshStill.body.deletedAt).not.toBeNull();
    });
  });

  describe('boot B — search/paging grid (isolated rate-limit bucket)', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let document: OpenAPIObject;

    beforeAll(async () => {
      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      document = booted.document;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);

      // A deterministic grid: 15 bookmarks across domains/titles/tags.
      // Tags go on via the dedicated PUT — `POST /bookmarks` deliberately
      // has no tags field (whitelist would strip it).
      const spec: Array<{ url: string; title: string; excerpt?: string; tags?: string[] }> = [
        { url: 'https://alpha.example.com/one', title: 'alpha one', excerpt: 'the first entry' },
        { url: 'https://alpha.example.com/two', title: 'Alpha Two', excerpt: 'the SECOND entry' },
        { url: 'https://beta.example.org/three', title: 'beta three' },
        { url: 'https://beta.example.org/four', title: 'Beta Four' },
        { url: 'https://gamma.example.net/five', title: 'GAMMA five', tags: ['grid'] },
        { url: 'https://gamma.example.net/six', title: 'gamma six', tags: ['Grid', 'special'] },
        { url: 'https://delta.example.com/seven', title: 'delta seven' },
        { url: 'https://delta.example.com/eight', title: 'delta eight' },
        { url: 'https://epsilon.example.com/nine', title: 'epsilon nine' },
        { url: 'https://zeta.example.com/ten', title: 'zeta ten' },
        { url: 'https://eta.example.com/eleven', title: 'eta eleven' },
        { url: 'https://theta.example.com/twelve', title: 'theta twelve' },
        { url: 'https://iota.example.com/thirteen', title: 'iota thirteen' },
        { url: 'https://kappa.example.com/fourteen', title: 'kappa fourteen' },
        { url: 'https://lambda.example.com/fifteen', title: 'lambda fifteen' },
      ];
      for (const item of spec) {
        const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
          bearer: admin.accessToken,
          body: item,
        });
        expect(created.status).toBe(201);
        if (item.tags !== undefined) {
          const tagged = await call<BookmarkView>(
            baseUrl,
            'PUT',
            `/bookmarks/${created.body.id}/tags`,
            { bearer: admin.accessToken, body: { tags: item.tags } },
          );
          expect(tagged.status).toBe(200);
          // Case-insensitive dedupe: exactly one tag per distinct name.
          expect(tagged.body.tags.map((tag) => tag.name.toLowerCase()).sort()).toEqual(
            [...new Set(item.tags.map((tag) => tag.toLowerCase()))].sort(),
          );
        }
      }
    }, 90_000);

    afterAll(async () => {
      await app.close();
    });

    it('search is case-insensitive across title, excerpt and tag names (AC/D10)', async () => {
      const byTitle = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?search=${encodeURIComponent('ALPHA')}`,
        { bearer: admin.accessToken },
      );
      expect(byTitle.body.totalCount).toBe(2);

      const byExcerpt = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?search=${encodeURIComponent('second')}`,
        { bearer: admin.accessToken },
      );
      expect(byTitle.body.totalCount).toBe(2); // sanity: previous call did not mutate state
      expect(byExcerpt.body.totalCount).toBe(1);
      expect(byExcerpt.body.items[0]!.title).toBe('Alpha Two');

      const byTagName = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?search=${encodeURIComponent('GRID')}`,
        { bearer: admin.accessToken },
      );
      expect(byTagName.body.totalCount).toBe(2); // both grid-tagged bookmarks

      const byTagExactFilter = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?tag=${encodeURIComponent('SPECIAL')}`,
        { bearer: admin.accessToken },
      );
      expect(byTagExactFilter.body.totalCount).toBe(1);

      // LIKE metacharacters match literally, not as wildcards.
      const literal = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?search=${encodeURIComponent('a_ha%')}`,
        { bearer: admin.accessToken },
      );
      expect(literal.body.totalCount).toBe(0);
    });

    it('domain filter matches the registrable domain case-insensitively', async () => {
      // alpha.example.com's registrable domain is example.com — the filter
      // matches DOMAINS, not hosts (plan D12).
      const res = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?domain=${encodeURIComponent('EXAMPLE.COM')}`,
        { bearer: admin.accessToken },
      );
      expect(res.status).toBe(200);
      expect(res.body.totalCount).toBe(11); // alpha×2 + delta×2 + seven singles
      expect(res.body.items.every((item) => item.urlParts.domain === 'example.com')).toBe(true);

      const org = await call<BookmarkListView>(baseUrl, 'GET', `/bookmarks?domain=example.org`, {
        bearer: admin.accessToken,
      });
      expect(org.body.totalCount).toBe(2);
      expect(org.body.items.every((item) => item.urlParts.domain === 'example.org')).toBe(true);

      // No matches → empty list, not an error.
      const none = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?domain=nowhere.example`,
        { bearer: admin.accessToken },
      );
      expect(none.body.totalCount).toBe(0);
    });

    it('unassignedOnly is accepted (everything is unassigned before M4)', async () => {
      const res = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?unassignedOnly=true', {
        bearer: admin.accessToken,
      });
      expect(res.status).toBe(200);
      expect(res.body.totalCount).toBe(15);
    });

    it('collectionId filters by membership (active since M4 — unknown ids match nothing)', async () => {
      const res = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?collectionId=${crypto.randomUUID()}`,
        { bearer: admin.accessToken },
      );
      expect(res.status).toBe(200); // valid uuid, no memberships → empty
      expect(res.body.totalCount).toBe(0);

      const bad = await call(baseUrl, 'GET', '/bookmarks?collectionId=not-a-uuid', {
        bearer: admin.accessToken,
      });
      expect(bad.status).toBe(400); // still validated
      expect(problem(bad).code).toBe('VALIDATION_FAILED');
    });

    it('pages deterministically with totalCount unaffected by paging', async () => {
      const page1 = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?page=1&pageSize=4', {
        bearer: admin.accessToken,
      });
      const page2 = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?page=2&pageSize=4', {
        bearer: admin.accessToken,
      });
      const page3 = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?page=3&pageSize=4', {
        bearer: admin.accessToken,
      });
      const page4 = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?page=4&pageSize=4', {
        bearer: admin.accessToken,
      });

      expect(page1.body.totalCount).toBe(15);
      expect(page1.body.page).toBe(1);
      expect(page1.body.pageSize).toBe(4);
      expect(page1.body.items).toHaveLength(4);
      expect(page2.body.items).toHaveLength(4);
      expect(page3.body.items).toHaveLength(4);
      expect(page4.body.items).toHaveLength(3); // 15 = 4+4+4+3

      const ids = new Set(
        [...page1.body.items, ...page2.body.items, ...page3.body.items, ...page4.body.items].map(
          (item) => item.id,
        ),
      );
      expect(ids.size).toBe(15); // no overlaps, no gaps
      expect(page1.body.items.some((item) => page2.body.items.some((o) => o.id === item.id))).toBe(
        false,
      );
    });

    it('sorts by updated desc (default), created desc, and title asc', async () => {
      const defaultSort = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks', {
        bearer: admin.accessToken,
      });
      const defaultDates = defaultSort.body.items.map((item) => item.updatedAt);
      expect([...defaultDates].sort().reverse()).toEqual(defaultDates);

      // Touch a middle row; it must jump to the front under `updated`.
      const target = defaultSort.body.items[7]!;
      await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${target.id}`, {
        bearer: admin.accessToken,
        body: { note: 'bumped' },
      });
      const afterBump = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks', {
        bearer: admin.accessToken,
      });
      expect(afterBump.body.items[0]!.id).toBe(target.id);

      const byTitle = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?sort=title', {
        bearer: admin.accessToken,
      });
      const titles = byTitle.body.items.map((item) => (item.title ?? '').toLowerCase());
      expect(titles).toEqual([...titles].sort());

      const byCreated = await call<BookmarkListView>(
        baseUrl,
        'GET',
        '/bookmarks?sort=created&pageSize=200',
        { bearer: admin.accessToken },
      );
      const createdDates = byCreated.body.items.map((item) => item.createdAt);
      expect([...createdDates].sort().reverse()).toEqual(createdDates);
    });

    it('updatedSince returns only rows touched after the cursor', async () => {
      const baseline = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?pageSize=200', {
        bearer: admin.accessToken,
      });
      const untouched = baseline.body.items[1]!;

      // Fresh cursor (microseconds matter at timestamptz precision): only
      // rows mutated AFTER this moment may appear.
      const cursor = new Date(Date.now() - 1).toISOString();
      await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${untouched.id}`, {
        bearer: admin.accessToken,
        body: { excerpt: 'delta query marker' },
      });

      const since = await call<BookmarkListView>(
        baseUrl,
        'GET',
        `/bookmarks?updatedSince=${encodeURIComponent(cursor)}&pageSize=200`,
        { bearer: admin.accessToken },
      );
      expect(since.body.totalCount).toBe(1);
      expect(since.body.items[0]!.id).toBe(untouched.id);
    });

    it('clamps pageSize > 200 to 200 (AC) and rejects garbage input', async () => {
      const clamped = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?pageSize=100000', {
        bearer: admin.accessToken,
      });
      expect(clamped.status).toBe(200);
      expect(clamped.body.pageSize).toBe(200);
      expect(clamped.body.totalCount).toBe(15); // full set in one page

      const zero = await call(baseUrl, 'GET', '/bookmarks?pageSize=0', {
        bearer: admin.accessToken,
      });
      expect(zero.status).toBe(400);
      expect(problem(zero).code).toBe('VALIDATION_FAILED');

      const negativePage = await call(baseUrl, 'GET', '/bookmarks?page=-3', {
        bearer: admin.accessToken,
      });
      expect(negativePage.status).toBe(400);

      const badSort = await call(baseUrl, 'GET', '/bookmarks?sort=magic', {
        bearer: admin.accessToken,
      });
      expect(badSort.status).toBe(400);

      const badSince = await call(baseUrl, 'GET', '/bookmarks?updatedSince=yesterday', {
        bearer: admin.accessToken,
      });
      expect(badSince.status).toBe(400);

      const unknownRoute = await call(baseUrl, 'GET', '/bookmarks/definitely-not-a-uuid', {
        bearer: admin.accessToken,
      });
      expect(unknownRoute.status).toBe(400); // uuid-validated path param
    });

    it('documents the M3 surface with explicit operation ids (D9)', () => {
      const operations = new Set<string>();
      for (const pathItem of Object.values(document.paths ?? {})) {
        for (const op of Object.values(pathItem ?? {})) {
          const operationId = (op as { operationId?: string }).operationId;
          if (operationId) operations.add(operationId);
        }
      }
      for (const id of [
        'createBookmark',
        'listBookmarks',
        'getBookmarkStats',
        'listBookmarkTags',
        'getBookmark',
        'updateBookmark',
        'deleteBookmark',
        'restoreBookmark',
        'replaceBookmarkTags',
        'renameTag',
        'deleteTag',
      ]) {
        expect(operations.has(id)).toBe(true);
      }
    });
  });
});
