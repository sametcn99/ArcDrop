import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { DOMParser } from 'linkedom';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { installTestEnv } from './helpers';

/**
 * M19 — Public sharing & RSS (plan D19 / Raindrop parity G15, G18) e2e suite.
 *
 * Covers every M19 acceptance criterion end-to-end against PostgreSQL:
 * - Owner share toggle (idempotent enable, disable + re-enable token rotation),
 *   `?shared=true|false` filter, ownership & trash 404s, PAT readOnly refusal,
 *   and CollectionDto / CollectionNodeDto / SyncChanges parity.
 * - Unauthenticated `GET /api/v1/public/collections/:shareToken` returning active
 *   nested tree (with `collection.parentId: null`, private ancestor ID hidden,
 *   trashed children excluded), deduplicated subtree bookmarks, strict 8-key
 *   allowlist (notes & highlights verified absent), and metadata-only file items
 *   (`url: null`, `GET /files/:id` stays 401).
 * - Unauthenticated `GET /api/v1/public/collections/:shareToken/rss` returning
 *   valid RSS 2.0 XML (`application/rss+xml; charset=utf-8`, `Cache-Control`,
 *   `X-Content-Type-Options: nosniff`), escaped XML entities, newest-first order,
 *   and 50-item cap.
 * - Immediate 404 on unshare/trash, indistinguishable 404s across unknown,
 *   malformed, disabled, and trashed tokens, and shared `/public/*` rate-limit
 *   bucket returning 429 `application/problem+json` (isolated Boot B).
 */

interface AuthSession {
  accessToken: string;
  user: { id: string; email: string; role: string };
}

interface CollectionShareState {
  enabled: boolean;
  shareToken: string | null;
}

interface CollectionView {
  id: string;
  parentId: string | null;
  title: string;
  bookmarkCount: number;
  share: CollectionShareState;
  children?: CollectionView[];
}

interface CollectionShareResponse {
  collectionId: string;
  enabled: boolean;
  shareToken: string | null;
  publicPath: string | null;
  rssPath: string | null;
}

interface PublicCollectionNode {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  order: number;
  bookmarkCount: number;
  children: PublicCollectionNode[];
}

interface PublicBookmark {
  title: string | null;
  url: string | null;
  excerpt: string | null;
  coverRef: string | null;
  iconRef: string | null;
  tags: string[];
  contentType: string;
  createdAt: string;
}

interface PublicCollectionPage {
  collection: PublicCollectionNode;
  collectionPath: string;
  items: PublicBookmark[];
  totalCount: number;
  page: number;
  pageSize: number;
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
  rawText: string;
  headers: Headers;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const ALLOWLISTED_PUBLIC_BOOKMARK_KEYS = [
  'contentType',
  'coverRef',
  'createdAt',
  'excerpt',
  'iconRef',
  'tags',
  'title',
  'url',
];

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
  const rawText = await res.text();
  const contentType = res.headers.get('content-type') ?? '';
  const body = (contentType.includes('json') && rawText ? JSON.parse(rawText) : rawText) as T;
  return { status: res.status, body, rawText, headers: res.headers };
}

async function uploadTextFile(
  baseUrl: string,
  bearer: string,
  fileName: string,
  contents: string,
  fields: Record<string, string | string[]> = {},
): Promise<CallResult<{ id: string; fileRef: string | null; contentType: string }>> {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(contents, 'utf8')], { type: 'text/plain' }), fileName);
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, item);
    } else {
      form.append(key, value);
    }
  }
  const res = await fetch(`${baseUrl}/api/v1/bookmarks/file`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
    body: form,
  });
  const rawText = await res.text();
  return {
    status: res.status,
    body: JSON.parse(rawText) as { id: string; fileRef: string | null; contentType: string },
    rawText,
    headers: res.headers,
  };
}

async function wipeData(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM upload_usage');
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

async function bootApp(options: {
  bypassGlobalThrottle: boolean;
}): Promise<{ app: INestApplication; baseUrl: string }> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.bypassGlobalThrottle) {
    builder.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true });
  }
  const moduleRef = await builder.compile();
  const config = loadConfig();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(0);
  return { app, baseUrl: await app.getUrl() };
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

function assertValidRssXml(xml: string) {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  // Check for unescaped ampersands outside known XML character/entity references.
  expect(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(xml)).toBe(false);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const rss = doc.querySelector('rss');
  expect(rss).not.toBeNull();
  expect(rss!.getAttribute('version')).toBe('2.0');
  const channel = rss!.querySelector('channel');
  expect(channel).not.toBeNull();
  return { doc, rss: rss!, channel: channel! };
}

describe('Public sharing & RSS M19 (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  describe('boot A — sharing lifecycle, nested trees, strict privacy allowlist, RSS 2.0 & 404 parity', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let alice: AuthSession;
    let bob: AuthSession;
    let savedPublicRateLimit: string | undefined;

    beforeAll(async () => {
      savedPublicRateLimit = process.env['ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE'];
      process.env['ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE'] = '200';
      const boot = await bootApp({ bypassGlobalThrottle: true });
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      alice = await createUserViaAdmin(baseUrl, admin, 'alice-m19@arcdrop.test');
      bob = await createUserViaAdmin(baseUrl, admin, 'bob-m19@arcdrop.test');
    }, 60_000);

    afterAll(async () => {
      if (savedPublicRateLimit === undefined) {
        delete process.env['ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE'];
      } else {
        process.env['ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE'] = savedPublicRateLimit;
      }
      await app?.close();
    });

    it('AC: owner sharing lifecycle, ?shared filter, PAT scope, sync snapshot, and collection tree metadata', async () => {
      const colA = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'Public Showcase' },
      });
      const colB = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'Private Vault' },
      });
      expect(colA.status).toBe(201);
      expect(colA.body.share).toEqual({ enabled: false, shareToken: null });

      const syncBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
        bearer: alice.accessToken,
      });

      // Enable share
      const enabled1 = await call<CollectionShareResponse>(
        baseUrl,
        'PUT',
        `/collections/${colA.body.id}/share`,
        { bearer: alice.accessToken, body: { enabled: true } },
      );
      expect(enabled1.status).toBe(200);
      expect(enabled1.body.collectionId).toBe(colA.body.id);
      expect(enabled1.body.enabled).toBe(true);
      expect(enabled1.body.shareToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(enabled1.body.publicPath).toBe(
        `/api/v1/public/collections/${enabled1.body.shareToken}`,
      );
      expect(enabled1.body.rssPath).toBe(
        `/api/v1/public/collections/${enabled1.body.shareToken}/rss`,
      );

      // Idempotent second enable keeps exact token
      const enabled2 = await call<CollectionShareResponse>(
        baseUrl,
        'PUT',
        `/collections/${colA.body.id}/share`,
        { bearer: alice.accessToken, body: { enabled: true } },
      );
      expect(enabled2.status).toBe(200);
      expect(enabled2.body.shareToken).toBe(enabled1.body.shareToken);

      // Sync changes, GET /collections/:id, GET /collections/tree include share
      const fetched = await call<CollectionView>(baseUrl, 'GET', `/collections/${colA.body.id}`, {
        bearer: alice.accessToken,
      });
      expect(fetched.status).toBe(200);
      expect(fetched.body.share).toEqual({ enabled: true, shareToken: enabled1.body.shareToken });

      const tree = await call<CollectionView[]>(baseUrl, 'GET', '/collections/tree', {
        bearer: alice.accessToken,
      });
      expect(tree.status).toBe(200);
      expect(tree.body.find((c) => c.id === colA.body.id)?.share).toEqual({
        enabled: true,
        shareToken: enabled1.body.shareToken,
      });

      const delta = await call<{
        changes: Array<{
          entity: string;
          action: string;
          id: string;
          snapshot: CollectionView | null;
        }>;
      }>(baseUrl, 'GET', `/sync/changes?since=${syncBefore.body.seq}`, {
        bearer: alice.accessToken,
      });
      const colUpdate = delta.body.changes.find(
        (c) => c.entity === 'collection' && c.id === colA.body.id && c.action === 'update',
      );
      expect(colUpdate?.snapshot?.share).toEqual({
        enabled: true,
        shareToken: enabled1.body.shareToken,
      });

      // ?shared=true / ?shared=false / invalid ?shared=bogus
      const sharedOnly = await call<{ items: CollectionView[] }>(
        baseUrl,
        'GET',
        '/collections?shared=true',
        { bearer: alice.accessToken },
      );
      expect(sharedOnly.status).toBe(200);
      expect(sharedOnly.body.items.map((c) => c.id)).toEqual([colA.body.id]);

      const unsharedOnly = await call<{ items: CollectionView[] }>(
        baseUrl,
        'GET',
        '/collections?shared=false',
        { bearer: alice.accessToken },
      );
      expect(unsharedOnly.status).toBe(200);
      expect(unsharedOnly.body.items.map((c) => c.id)).toEqual([colB.body.id]);

      const invalidQuery = await call<Problem>(baseUrl, 'GET', '/collections?shared=bogus', {
        bearer: alice.accessToken,
      });
      expect(invalidQuery.status).toBe(400);
      expect(invalidQuery.body.code).toBe('VALIDATION_FAILED');

      // Foreign user gets 404
      const foreignShare = await call<Problem>(
        baseUrl,
        'PUT',
        `/collections/${colA.body.id}/share`,
        { bearer: bob.accessToken, body: { enabled: false } },
      );
      expect(foreignShare.status).toBe(404);

      // PAT scope: readOnly PAT gets 403, read-write PAT succeeds
      const roPat = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
        bearer: alice.accessToken,
        body: { name: 'ro', readOnly: true },
      });
      const rwPat = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
        bearer: alice.accessToken,
        body: { name: 'rw', readOnly: false },
      });
      expect(
        (
          await call(baseUrl, 'PUT', `/collections/${colB.body.id}/share`, {
            bearer: roPat.body.token,
            body: { enabled: true },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call(baseUrl, 'PUT', `/collections/${colB.body.id}/share`, {
            bearer: rwPat.body.token,
            body: { enabled: true },
          })
        ).status,
      ).toBe(200);

      // Disable -> clears token; Re-enable -> rotates to a new token
      const disabled = await call<CollectionShareResponse>(
        baseUrl,
        'PUT',
        `/collections/${colA.body.id}/share`,
        { bearer: alice.accessToken, body: { enabled: false } },
      );
      expect(disabled.status).toBe(200);
      expect(disabled.body).toEqual({
        collectionId: colA.body.id,
        enabled: false,
        shareToken: null,
        publicPath: null,
        rssPath: null,
      });

      const rotated = await call<CollectionShareResponse>(
        baseUrl,
        'PUT',
        `/collections/${colA.body.id}/share`,
        { bearer: alice.accessToken, body: { enabled: true } },
      );
      expect(rotated.status).toBe(200);
      expect(rotated.body.shareToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(rotated.body.shareToken).not.toBe(enabled1.body.shareToken);
    });

    it('AC: nested subtree, strict 8-field allowlist, notes & highlights absent, metadata-only files, RSS XML & identical 404s', async () => {
      // Build 3-level hierarchy: Grandparent -> SharedRoot & Co. -> Child <Tag> -> Grandchild
      // plus TrashedChild and outside Sibling
      const grandparent = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'Grandparent' },
      });
      const sharedRoot = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: {
          title: 'SharedRoot & Co.',
          parentId: grandparent.body.id,
          icon: 'folder',
          color: '#3b82f6',
        },
      });
      const child = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'Child <Tag>', parentId: sharedRoot.body.id },
      });
      const grandchild = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'Grandchild', parentId: child.body.id },
      });
      const trashedChild = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'Trashed Child', parentId: sharedRoot.body.id },
      });
      const outsideSibling = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'Private Sibling', parentId: grandparent.body.id },
      });

      const shareRes = await call<CollectionShareResponse>(
        baseUrl,
        'PUT',
        `/collections/${sharedRoot.body.id}/share`,
        { bearer: alice.accessToken, body: { enabled: true } },
      );
      expect(shareRes.status).toBe(200);
      const token = shareRes.body.shareToken!;

      // Create bookmarks with sensitive notes, highlights, favorites, reminders, tags, and cover/icon refs
      const secretNoteRoot = 'TOP_SECRET_ROOT_NOTE_ALPHA';
      const secretHighlightText = 'TOP_SECRET_HIGHLIGHT_PASSAGE_BETA';
      const secretHighlightNote = 'TOP_SECRET_HIGHLIGHT_COMMENT_GAMMA';

      const bmRoot = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: {
          url: 'https://example.org/deep-guide?a=1&b=2',
          title: 'Deep Guide & Notes',
          excerpt: 'Public excerpt with <script> & "quotes"',
          note: secretNoteRoot,
          favorite: true,
          reminderAt: '2027-05-01T10:00:00.000Z',
        },
      });
      expect(bmRoot.status).toBe(201);
      await call(baseUrl, 'PUT', `/bookmarks/${bmRoot.body.id}/tags`, {
        bearer: alice.accessToken,
        body: { tags: ['Architecture', 'XML & <Tags>'] },
      });
      // Assign to BOTH sharedRoot and child -> verify deduplication!
      await call(baseUrl, 'PUT', `/bookmarks/${bmRoot.body.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [sharedRoot.body.id, child.body.id] },
      });
      await call(baseUrl, 'POST', `/bookmarks/${bmRoot.body.id}/highlights`, {
        bearer: alice.accessToken,
        body: { text: secretHighlightText, note: secretHighlightNote, color: 'yellow' },
      });
      // Simulate server-owned coverRef / iconRef
      await dataSource.query(`UPDATE bookmarks SET cover_ref = $1, icon_ref = $2 WHERE id = $3`, [
        'sampleCoverRef1234567890.png',
        'sampleIconRef1234567890.ico',
        bmRoot.body.id,
      ]);

      const bmGrandchild = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: {
          url: 'https://example.org/grandchild?x=1&y=2',
          title: '"Grandchild" & <Nested> \'Entry\'',
          excerpt: 'Nested summary',
          note: 'TOP_SECRET_NESTED_NOTE_DELTA',
        },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${bmGrandchild.body.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [grandchild.body.id] },
      });

      // File-backed bookmark inside Child with private note & highlight
      const bmFile = await uploadTextFile(
        baseUrl,
        alice.accessToken,
        'private-spec.txt',
        'PRIVATE_FILE_BYTES_TOKEN_EPSILON',
        {
          title: 'Public Metadata Only File',
          excerpt: 'Summary only, no file bytes',
          note: 'TOP_SECRET_FILE_NOTE_ZETA',
          tags: ['Specs'],
          collectionIds: [child.body.id],
        },
      );
      expect(bmFile.status).toBe(201);
      await call(baseUrl, 'POST', `/bookmarks/${bmFile.body.id}/highlights`, {
        bearer: alice.accessToken,
        body: { text: 'PRIVATE_FILE_HIGHLIGHT_ETA', note: 'PRIVATE_FILE_HL_NOTE' },
      });

      // Trashed bookmark in Child (must NOT appear)
      const bmTrashed = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: 'https://example.org/trashed', title: 'Trashed Entry' },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${bmTrashed.body.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [child.body.id] },
      });
      await call(baseUrl, 'DELETE', `/bookmarks/${bmTrashed.body.id}`, {
        bearer: alice.accessToken,
      });

      // Active bookmark in TrashedChild, plus trash TrashedChild (must NOT appear)
      const bmInTrashedChild = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: 'https://example.org/in-trashed-child', title: 'Hidden Under Trashed Child' },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${bmInTrashedChild.body.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [trashedChild.body.id] },
      });
      await call(baseUrl, 'DELETE', `/collections/${trashedChild.body.id}`, {
        bearer: alice.accessToken,
      });

      // Bookmark outside subtree (in Grandparent & outsideSibling)
      const bmOutside = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: 'https://example.org/outside', title: 'Outside Subtree Entry' },
      });
      await call(baseUrl, 'PUT', `/bookmarks/${bmOutside.body.id}/collections`, {
        bearer: alice.accessToken,
        body: { collectionIds: [grandparent.body.id, outsideSibling.body.id] },
      });

      // Ensure deterministic descending createdAt order across the 3 visible items
      await dataSource.query(
        `UPDATE bookmarks SET created_at = NOW() - INTERVAL '30 minutes' WHERE id = $1`,
        [bmRoot.body.id],
      );
      await dataSource.query(
        `UPDATE bookmarks SET created_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`,
        [bmGrandchild.body.id],
      );
      await dataSource.query(
        `UPDATE bookmarks SET created_at = NOW() - INTERVAL '10 minutes' WHERE id = $1`,
        [bmFile.body.id],
      );

      // 1. Unauthenticated fetch: tree, counts, allowlist, privacy
      const pub = await call<PublicCollectionPage>(baseUrl, 'GET', `/public/collections/${token}`);
      expect(pub.status).toBe(200);
      expect(pub.headers.get('cache-control')).toBe('public, max-age=60');
      expect(pub.body.collectionPath).toBe('Grandparent / SharedRoot & Co.');
      expect(pub.body.collection.id).toBe(sharedRoot.body.id);
      expect(pub.body.collection.parentId).toBeNull(); // private grandparent id never exposed!
      expect(pub.body.collection.bookmarkCount).toBe(1); // bmRoot direct
      expect(pub.body.collection.children.map((c) => c.id)).toEqual([child.body.id]); // TrashedChild excluded
      expect(pub.body.collection.children[0]!.parentId).toBe(sharedRoot.body.id);
      expect(pub.body.collection.children[0]!.bookmarkCount).toBe(2); // bmRoot + bmFile (bmTrashed excluded)
      expect(pub.body.collection.children[0]!.children.map((c) => c.id)).toEqual([
        grandchild.body.id,
      ]);
      expect(pub.body.collection.children[0]!.children[0]!.bookmarkCount).toBe(1); // bmGrandchild

      expect(pub.body.totalCount).toBe(3);
      expect(pub.body.items.length).toBe(3);

      // Strict 8-key allowlist check on EVERY item
      for (const item of pub.body.items) {
        expect(Object.keys(item).sort()).toEqual(ALLOWLISTED_PUBLIC_BOOKMARK_KEYS);
      }

      const fileItem = pub.body.items.find((i) => i.title === 'Public Metadata Only File')!;
      expect(fileItem).toBeDefined();
      expect(fileItem.url).toBeNull();
      expect(fileItem.coverRef).toBeNull();
      expect(fileItem.iconRef).toBeNull();
      expect(fileItem.contentType).toBe('document');
      expect(fileItem.tags).toEqual(['Specs']);

      const rootItem = pub.body.items.find((i) => i.title === 'Deep Guide & Notes')!;
      expect(rootItem).toBeDefined();
      expect(rootItem.url).toBe('https://example.org/deep-guide?a=1&b=2');
      expect(rootItem.coverRef).toBe('sampleCoverRef1234567890.png');
      expect(rootItem.iconRef).toBe('sampleIconRef1234567890.ico');
      expect(rootItem.tags.sort()).toEqual(['Architecture', 'XML & <Tags>']);

      // Private data NEVER appears anywhere in raw payload
      for (const forbidden of [
        secretNoteRoot,
        secretHighlightText,
        secretHighlightNote,
        'TOP_SECRET_NESTED_NOTE_DELTA',
        'TOP_SECRET_FILE_NOTE_ZETA',
        'PRIVATE_FILE_HIGHLIGHT_ETA',
        'PRIVATE_FILE_HL_NOTE',
        'PRIVATE_FILE_BYTES_TOKEN_EPSILON',
        bmFile.body.fileRef!,
        'private-spec.txt',
        grandparent.body.id,
        outsideSibling.body.id,
        trashedChild.body.id,
        'Trashed Entry',
        'Hidden Under Trashed Child',
        'Outside Subtree Entry',
        '"note":',
        '"highlights":',
        '"favorite":',
        '"reminderAt":',
        '"fileRef":',
      ]) {
        expect(pub.rawText).not.toContain(forbidden);
      }

      // Uploaded file bytes remain strictly private (401 anonymous)
      expect((await call(baseUrl, 'GET', `/files/${bmFile.body.id}`)).status).toBe(401);

      // 2. ?collectionId filtering & paging & pageSize clamping
      const filteredChild = await call<PublicCollectionPage>(
        baseUrl,
        'GET',
        `/public/collections/${token}?collectionId=${grandchild.body.id}`,
      );
      expect(filteredChild.status).toBe(200);
      expect(filteredChild.body.totalCount).toBe(1);
      expect(filteredChild.body.items.map((i) => i.title)).toEqual([
        '"Grandchild" & <Nested> \'Entry\'',
      ]);

      // Out-of-subtree collectionIds -> 404 identical
      for (const badColId of [
        grandparent.body.id,
        outsideSibling.body.id,
        trashedChild.body.id,
        randomUUID(),
      ]) {
        const res = await call<Problem>(
          baseUrl,
          'GET',
          `/public/collections/${token}?collectionId=${badColId}`,
        );
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('NOT_FOUND');
        expect(res.body.detail).toBe('Shared collection not found');
      }

      const paged1 = await call<PublicCollectionPage>(
        baseUrl,
        'GET',
        `/public/collections/${token}?page=1&pageSize=2`,
      );
      expect(paged1.body.items.length).toBe(2);
      expect(paged1.body.totalCount).toBe(3);

      const clamped = await call<PublicCollectionPage>(
        baseUrl,
        'GET',
        `/public/collections/${token}?pageSize=500`,
      );
      expect(clamped.status).toBe(200);
      expect(clamped.body.pageSize).toBe(200);

      // 3. RSS 2.0 XML validation, channel title = collectionPath, escaped XML, file item omits <link>
      const rssRes = await call<string>(baseUrl, 'GET', `/public/collections/${token}/rss`);
      expect(rssRes.status).toBe(200);
      expect(rssRes.headers.get('content-type')).toMatch(/^application\/rss\+xml/);
      expect(rssRes.headers.get('cache-control')).toBe('public, max-age=60');
      expect(rssRes.headers.get('x-content-type-options')).toBe('nosniff');

      const { channel } = assertValidRssXml(rssRes.rawText);
      const channelTitle = channel.querySelector(':scope > title')?.textContent;
      expect(channelTitle).toBe('Grandparent / SharedRoot & Co.');

      const rssItems = [...channel.querySelectorAll(':scope > item')];
      expect(rssItems.length).toBe(3);
      // Ordered newest first: bmFile -> bmGrandchild -> bmRoot
      expect(rssItems.map((el) => el.querySelector('title')?.textContent)).toEqual([
        'Public Metadata Only File',
        '"Grandchild" & <Nested> \'Entry\'',
        'Deep Guide & Notes',
      ]);
      // File-backed item omits <link>
      expect(rssItems[0]!.querySelector('link')).toBeNull();
      // URL items keep <link> (with escaped query ampersand decoded cleanly by XML parser)
      expect(rssItems[1]!.querySelector('link')?.textContent).toBe(
        'https://example.org/grandchild?x=1&y=2',
      );
      expect(rssItems[2]!.querySelector('link')?.textContent).toBe(
        'https://example.org/deep-guide?a=1&b=2',
      );
      for (const forbidden of [
        secretNoteRoot,
        secretHighlightText,
        secretHighlightNote,
        'TOP_SECRET_NESTED_NOTE_DELTA',
        'TOP_SECRET_FILE_NOTE_ZETA',
        'PRIVATE_FILE_BYTES_TOKEN_EPSILON',
        bmFile.body.fileRef!,
      ]) {
        expect(rssRes.rawText).not.toContain(forbidden);
      }

      // 4. Unshare -> immediate 404 identical to unknown/malformed/trashed tokens
      const unknownJson = await call<Problem>(
        baseUrl,
        'GET',
        '/public/collections/nonexistentTokenValue012345678901',
      );
      const malformedJson = await call<Problem>(baseUrl, 'GET', '/public/collections/bad!token');
      const unknownRss = await call<Problem>(
        baseUrl,
        'GET',
        '/public/collections/nonexistentTokenValue012345678901/rss',
      );

      // Disable share
      expect(
        (
          await call(baseUrl, 'PUT', `/collections/${sharedRoot.body.id}/share`, {
            bearer: alice.accessToken,
            body: { enabled: false },
          })
        ).status,
      ).toBe(200);

      const disabledJson = await call<Problem>(baseUrl, 'GET', `/public/collections/${token}`);
      const disabledRss = await call<Problem>(baseUrl, 'GET', `/public/collections/${token}/rss`);

      for (const res of [unknownJson, malformedJson, unknownRss, disabledJson, disabledRss]) {
        expect(res.status).toBe(404);
        expect(res.headers.get('content-type')).toContain('application/problem+json');
        expect(res.body.code).toBe('NOT_FOUND');
        expect(res.body.detail).toBe('Shared collection not found');
      }

      // Re-enable share -> new rotated token works, old token stays 404
      const reenabled = await call<CollectionShareResponse>(
        baseUrl,
        'PUT',
        `/collections/${sharedRoot.body.id}/share`,
        { bearer: alice.accessToken, body: { enabled: true } },
      );
      expect(reenabled.status).toBe(200);
      expect(reenabled.body.shareToken).not.toBe(token);
      expect((await call(baseUrl, 'GET', `/public/collections/${token}`)).status).toBe(404);
      expect(
        (await call(baseUrl, 'GET', `/public/collections/${reenabled.body.shareToken}`)).status,
      ).toBe(200);

      // Trash a shared collection -> public endpoints immediately return identical 404
      const tempCol = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'About To Be Trashed' },
      });
      const tempShare = await call<CollectionShareResponse>(
        baseUrl,
        'PUT',
        `/collections/${tempCol.body.id}/share`,
        { bearer: alice.accessToken, body: { enabled: true } },
      );
      expect(
        (await call(baseUrl, 'GET', `/public/collections/${tempShare.body.shareToken}`)).status,
      ).toBe(200);
      expect(
        (
          await call(baseUrl, 'DELETE', `/collections/${tempCol.body.id}`, {
            bearer: alice.accessToken,
          })
        ).status,
      ).toBe(204);
      const trashedJson = await call<Problem>(
        baseUrl,
        'GET',
        `/public/collections/${tempShare.body.shareToken}`,
      );
      const trashedRss = await call<Problem>(
        baseUrl,
        'GET',
        `/public/collections/${tempShare.body.shareToken}/rss`,
      );
      expect(trashedJson.status).toBe(404);
      expect(trashedJson.body.detail).toBe('Shared collection not found');
      expect(trashedRss.status).toBe(404);
      expect(trashedRss.body.detail).toBe('Shared collection not found');
      // Trashed shared collection cannot have share toggled
      expect(
        (
          await call(baseUrl, 'PUT', `/collections/${tempCol.body.id}/share`, {
            bearer: alice.accessToken,
            body: { enabled: false },
          })
        ).status,
      ).toBe(404);
    }, 30_000);

    it('AC: RSS feed returns newest 50 items in descending order across 55 bookmarks', async () => {
      const col = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: bob.accessToken,
        body: { title: 'RSS Cap 50' },
      });
      const share = await call<CollectionShareResponse>(
        baseUrl,
        'PUT',
        `/collections/${col.body.id}/share`,
        { bearer: bob.accessToken, body: { enabled: true } },
      );
      expect(share.status).toBe(200);
      const token = share.body.shareToken!;

      for (let i = 1; i <= 55; i++) {
        const label = String(i).padStart(2, '0');
        const created = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
          bearer: bob.accessToken,
          body: { url: `https://example.org/rss-item-${label}`, title: `Feed Item ${label}` },
        });
        expect(created.status).toBe(201);
        await call(baseUrl, 'PUT', `/bookmarks/${created.body.id}/collections`, {
          bearer: bob.accessToken,
          body: { collectionIds: [col.body.id] },
        });
        // Stagger created_at: Item 01 = 55m ago (oldest) ... Item 55 = 1m ago (newest)
        const minutesAgo = 56 - i;
        await dataSource.query(
          `UPDATE bookmarks SET created_at = NOW() - ($1 || ' minutes')::interval WHERE id = $2`,
          [String(minutesAgo), created.body.id],
        );
      }

      const rss = await call<string>(baseUrl, 'GET', `/public/collections/${token}/rss`);
      expect(rss.status).toBe(200);
      const { channel } = assertValidRssXml(rss.rawText);
      const items = [...channel.querySelectorAll(':scope > item')];
      expect(items.length).toBe(50);

      const titles = items.map((el) => el.querySelector('title')?.textContent);
      expect(titles[0]).toBe('Feed Item 55');
      expect(titles[49]).toBe('Feed Item 06');
      for (const dropped of [
        'Feed Item 01',
        'Feed Item 02',
        'Feed Item 03',
        'Feed Item 04',
        'Feed Item 05',
      ]) {
        expect(titles).not.toContain(dropped);
      }
    }, 30_000);
  });

  describe('boot B — isolated global /public/* per-IP rate-limit bucket', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let shareToken: string;
    let savedPublicRateLimit: string | undefined;

    beforeAll(async () => {
      savedPublicRateLimit = process.env['ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE'];
      process.env['ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE'] = '5';
      const boot = await bootApp({ bypassGlobalThrottle: false });
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);

      const admin = await bootstrapAdmin(baseUrl);
      const col = await call<CollectionView>(baseUrl, 'POST', '/collections', {
        bearer: admin.accessToken,
        body: { title: 'Rate Limited Feed' },
      });
      const share = await call<CollectionShareResponse>(
        baseUrl,
        'PUT',
        `/collections/${col.body.id}/share`,
        { bearer: admin.accessToken, body: { enabled: true } },
      );
      expect(share.status).toBe(200);
      shareToken = share.body.shareToken!;
    }, 60_000);

    afterAll(async () => {
      if (savedPublicRateLimit === undefined) {
        delete process.env['ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE'];
      } else {
        process.env['ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE'] = savedPublicRateLimit;
      }
      await app?.close();
    });

    it('AC: trips 429 problem+json after ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE shared across JSON & RSS endpoints', async () => {
      // 5 allowed requests mixed across JSON and RSS endpoints
      for (let i = 0; i < 5; i++) {
        const path =
          i % 2 === 0
            ? `/public/collections/${shareToken}`
            : `/public/collections/${shareToken}/rss`;
        const res = await call(baseUrl, 'GET', path);
        expect(res.status).toBe(200);
      }

      // 6th request trips the shared /public/* bucket -> 429 problem+json
      const sixthJson = await call<Problem>(baseUrl, 'GET', `/public/collections/${shareToken}`);
      expect(sixthJson.status).toBe(429);
      expect(sixthJson.headers.get('content-type')).toContain('application/problem+json');
      expect(sixthJson.body.code).toBe('TOO_MANY_REQUESTS');

      const seventhRss = await call<Problem>(
        baseUrl,
        'GET',
        `/public/collections/${shareToken}/rss`,
      );
      expect(seventhRss.status).toBe(429);
      expect(seventhRss.headers.get('content-type')).toContain('application/problem+json');
      expect(seventhRss.body.code).toBe('TOO_MANY_REQUESTS');
    });
  });
});
