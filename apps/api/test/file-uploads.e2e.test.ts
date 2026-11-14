import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { TrashPurgeService } from '../src/bookmarks/trash-purge.service';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { FileEvictionService } from '../src/files/file-eviction.service';
import { BrokenLinksService } from '../src/library-health/broken-links.service';
import { createZipBuffer } from '../src/portability/export/zip-writer';
import { readZipEntries } from '../src/portability/import/zip-reader';
import {
  DEFAULT_FILE_MAX_BYTES,
  DEFAULT_MONTHLY_UPLOAD_QUOTA_BYTES,
} from '../src/settings/settings.dto';
import { installTestEnv } from './helpers';

/**
 * M18 — File uploads (plan D19 / Raindrop parity G17) e2e suite.
 *
 * Boots the full NestJS application against PostgreSQL with `METADATA_ENABLED=false`
 * (proving text-bearing uploads are extracted locally from the volume with zero
 * network/SSRF fetches) and exercises every acceptance criterion end-to-end.
 */

interface BookmarkView {
  id: string;
  storageKind: 'url' | 'file';
  url: string | null;
  urlParts: Record<string, unknown> | null;
  title: string | null;
  excerpt: string | null;
  note: string | null;
  favorite: boolean;
  contentType: string;
  fileRef: string | null;
  fileName: string | null;
  fileMime: string | null;
  fileSize: number | null;
  cacheStatus: 'pending' | 'ready' | 'failed' | 'invalid-origin' | 'skipped';
  cacheCheckedAt: string | null;
  tags: Array<{ id: string; name: string }>;
  brokenAt: string | null;
  lastCheckedAt: string | null;
  deletedAt: string | null;
}

interface BookmarkListView {
  items: BookmarkView[];
  totalCount: number;
}

interface AuthSession {
  accessToken: string;
  user: { id: string; email: string; role: string };
}

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  limitBytes?: number;
  usedBytes?: number;
  resetAt?: string;
}

interface CallResult<T> {
  status: number;
  body: T;
  headers: Headers;
  rawBuffer?: Buffer;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(timeoutMs: number, probe: () => Promise<boolean> | boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await sleep(40);
  }
  throw new Error('condition not met within the deadline');
}

async function call<T = Record<string, unknown>>(
  baseUrl: string,
  method: Method,
  path: string,
  init: { body?: unknown; bearer?: string; binary?: boolean } = {},
): Promise<CallResult<T>> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.bearer) headers['authorization'] = `Bearer ${init.bearer}`;
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (init.binary) {
    const rawBuffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: rawBuffer as unknown as T, headers: res.headers, rawBuffer };
  }
  const contentType = res.headers.get('content-type') ?? '';
  const body = (
    contentType.includes('json') ? ((await res.json()) as T) : ((await res.text()) as unknown as T)
  ) as T;
  return { status: res.status, body, headers: res.headers };
}

async function uploadMultipart<T = BookmarkView>(
  baseUrl: string,
  path: string,
  bearer: string,
  file: { name: string; mime: string; bytes: Uint8Array } | null,
  fields: Record<string, string | string[]> = {},
): Promise<CallResult<T>> {
  const form = new FormData();
  if (file !== null) {
    form.append('file', new Blob([file.bytes], { type: file.mime }), file.name);
  }
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, item);
    } else {
      form.append(key, value);
    }
  }
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
    body: form,
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = (
    contentType.includes('json') ? ((await res.json()) as T) : ((await res.text()) as unknown as T)
  ) as T;
  return { status: res.status, body, headers: res.headers };
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

function buildMinimalEpub(title: string, chapterText: string): Buffer {
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;
  const ch1 = `<html><body><h1>Chapter One</h1><p>${chapterText}</p></body></html>`;
  return createZipBuffer([
    { name: 'mimetype', bytes: Buffer.from('application/epub+zip', 'utf8') },
    { name: 'META-INF/container.xml', bytes: Buffer.from(containerXml, 'utf8') },
    { name: 'OEBPS/content.opf', bytes: Buffer.from(opfXml, 'utf8') },
    { name: 'OEBPS/ch1.xhtml', bytes: Buffer.from(ch1, 'utf8') },
  ]);
}

// 1x1 valid PNG
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

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

const filesDir = (): string => join(process.env.ARCDROP__DATA_DIR ?? '/data', 'files');
const archiveDirOf = (id: string): string =>
  join(process.env.ARCDROP__DATA_DIR ?? '/data', 'archives', id);

describe('File uploads M18 (e2e)', () => {
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
    alice = await createUserViaAdmin(baseUrl, admin, 'alice-files@arcdrop.test');
    bob = await createUserViaAdmin(baseUrl, admin, 'bob-files@arcdrop.test');
  }, 60_000);

  afterAll(async () => {
    await sleep(100);
    await app?.close();
  });

  it('AC: uploads PDF, EPUB, MD, TXT, PNG, MP3, MP4 with storageKind=file, MIME-mapped types, change events, and rejects disallowed MIMEs (415)', async () => {
    const colRes = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
      bearer: alice.accessToken,
      body: { title: 'Documents' },
    });
    expect(colRes.status).toBe(201);
    const docsColId = colRes.body.id;

    const syncBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });

    const pdfBytes = buildSimplePdf('ArcDrop Private PDF QuartzNebulaToken');
    const pdfRes = await uploadMultipart(
      baseUrl,
      '/bookmarks/file',
      alice.accessToken,
      { name: 'architecture-spec.pdf', mime: 'application/pdf', bytes: pdfBytes },
      {
        title: 'Architecture Spec PDF',
        excerpt: 'PDF system design',
        note: 'Uploaded directly',
        favorite: 'true',
        tags: JSON.stringify(['Specs', 'PDF']),
        collectionIds: docsColId,
      },
    );
    expect(pdfRes.status).toBe(201);
    expect(pdfRes.body.storageKind).toBe('file');
    expect(pdfRes.body.url).toBeNull();
    expect(pdfRes.body.urlParts).toBeNull();
    expect(pdfRes.body.contentType).toBe('document');
    expect(pdfRes.body.fileName).toBe('architecture-spec.pdf');
    expect(pdfRes.body.fileMime).toBe('application/pdf');
    expect(pdfRes.body.fileSize).toBe(pdfBytes.byteLength);
    expect(pdfRes.body.fileRef).toMatch(/\.pdf$/);
    expect(pdfRes.body.favorite).toBe(true);
    expect(pdfRes.body.tags.map((t) => t.name).sort()).toEqual(['PDF', 'Specs']);
    expect(pdfRes.body.cacheStatus).toBe('ready');

    // Sync change-log recorded bookmark:create + collection:update + tags
    const syncDelta = await call<{
      changes: Array<{ entity: string; action: string; id: string; snapshot: BookmarkView | null }>;
    }>(baseUrl, 'GET', `/sync/changes?since=${syncBefore.body.seq}`, { bearer: alice.accessToken });
    const createEvt = syncDelta.body.changes.find(
      (c) => c.entity === 'bookmark' && c.id === pdfRes.body.id && c.action === 'create',
    );
    expect(createEvt).toBeDefined();
    expect(createEvt!.snapshot?.storageKind).toBe('file');
    expect(createEvt!.snapshot?.url).toBeNull();

    // EPUB -> book
    const epubBytes = buildMinimalEpub(
      'Consensus Primer',
      'Distributed epubkeywordhyperion passage from spine.',
    );
    const epubRes = await uploadMultipart(baseUrl, '/bookmarks/file', alice.accessToken, {
      name: 'consensus.epub',
      mime: 'application/epub+zip',
      bytes: epubBytes,
    });
    expect(epubRes.status).toBe(201);
    expect(epubRes.body.contentType).toBe('book');
    expect(epubRes.body.title).toBe('Consensus Primer'); // extracted from <dc:title>
    expect(epubRes.body.cacheStatus).toBe('ready');

    // Markdown -> document (defaults title to filename stem)
    const mdBytes = Buffer.from(
      '# Storage Notes\n\nWrite-ahead logging uses markdownuniquecipher in the body.\n',
      'utf8',
    );
    const mdRes = await uploadMultipart(baseUrl, '/bookmarks/file', alice.accessToken, {
      name: 'storage-notes.md',
      mime: 'text/markdown',
      bytes: mdBytes,
    });
    expect(mdRes.status).toBe(201);
    expect(mdRes.body.contentType).toBe('document');
    expect(mdRes.body.title).toBe('storage-notes');
    expect(mdRes.body.cacheStatus).toBe('ready');

    // TXT -> document
    const txtRes = await uploadMultipart(baseUrl, '/bookmarks/file', alice.accessToken, {
      name: 'plain.txt',
      mime: 'text/plain',
      bytes: Buffer.from('Plain text plaincipheremerald entry.', 'utf8'),
    });
    expect(txtRes.status).toBe(201);
    expect(txtRes.body.contentType).toBe('document');
    expect(txtRes.body.cacheStatus).toBe('ready');

    // Image (PNG) -> image (non-extractable -> cacheStatus = skipped)
    const imgRes = await uploadMultipart(baseUrl, '/bookmarks/file', alice.accessToken, {
      name: 'pixel.png',
      mime: 'image/png',
      bytes: TINY_PNG,
    });
    expect(imgRes.status).toBe(201);
    expect(imgRes.body.contentType).toBe('image');
    expect(imgRes.body.cacheStatus).toBe('skipped');

    // Audio (MP3) & Video (MP4)
    const audioRes = await uploadMultipart(baseUrl, '/bookmarks/file', alice.accessToken, {
      name: 'clip.mp3',
      mime: 'audio/mpeg',
      bytes: Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00fake-mp3-frame', 'utf8'),
    });
    expect(audioRes.status).toBe(201);
    expect(audioRes.body.contentType).toBe('audio');
    expect(audioRes.body.cacheStatus).toBe('skipped');

    const videoRes = await uploadMultipart(baseUrl, '/bookmarks/file', alice.accessToken, {
      name: 'demo.mp4',
      mime: 'video/mp4',
      bytes: Buffer.from('\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom', 'latin1'),
    });
    expect(videoRes.status).toBe(201);
    expect(videoRes.body.contentType).toBe('video');
    expect(videoRes.body.cacheStatus).toBe('skipped');

    // Disallowed MIMEs -> 415 UNSUPPORTED_MEDIA_TYPE
    for (const bad of [
      { name: 'page.html', mime: 'text/html', bytes: Buffer.from('<h1>Hi</h1>') },
      { name: 'vector.svg', mime: 'image/svg+xml', bytes: Buffer.from('<svg/>') },
      { name: 'app.exe', mime: 'application/octet-stream', bytes: Buffer.from('MZ') },
    ]) {
      const rejected = await uploadMultipart<Problem>(
        baseUrl,
        '/bookmarks/file',
        alice.accessToken,
        bad,
      );
      expect(rejected.status).toBe(415);
      expect(rejected.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }

    // Missing or empty file -> 400
    const missing = await uploadMultipart<Problem>(
      baseUrl,
      '/bookmarks/file',
      alice.accessToken,
      null,
    );
    expect(missing.status).toBe(400);
    const empty = await uploadMultipart<Problem>(baseUrl, '/bookmarks/file', alice.accessToken, {
      name: 'empty.txt',
      mime: 'text/plain',
      bytes: Buffer.alloc(0),
    });
    expect(empty.status).toBe(400);

    // URL bookmark alongside files to verify GET /files/:id rejects URL bookmarks
    const urlBm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://example.com/healthy-page', title: 'Healthy URL Bookmark' },
    });
    expect(urlBm.status).toBe(201);

    // -- AC: Private serving (auth REQUIRED, ownership enforced, byte-identical roundtrip) --
    const unauth = await call(baseUrl, 'GET', `/files/${pdfRes.body.id}`);
    expect(unauth.status).toBe(401);

    const foreign = await call(baseUrl, 'GET', `/files/${pdfRes.body.id}`, {
      bearer: bob.accessToken,
    });
    expect(foreign.status).toBe(404);

    const onUrlBm = await call(baseUrl, 'GET', `/files/${urlBm.body.id}`, {
      bearer: alice.accessToken,
    });
    expect(onUrlBm.status).toBe(404);

    const inlineGet = await call<Buffer>(baseUrl, 'GET', `/files/${pdfRes.body.id}`, {
      bearer: alice.accessToken,
      binary: true,
    });
    expect(inlineGet.status).toBe(200);
    expect(inlineGet.headers.get('content-type')).toBe('application/pdf');
    expect(inlineGet.headers.get('content-disposition')).toContain('inline;');
    expect(inlineGet.headers.get('content-disposition')).toContain('architecture-spec.pdf');
    expect(inlineGet.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(inlineGet.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.compare(inlineGet.rawBuffer!, Buffer.from(pdfBytes))).toBe(0);

    // Fetching by fileRef + ?download=1 yields Content-Disposition: attachment
    const dlGet = await call<Buffer>(
      baseUrl,
      'GET',
      `/files/${encodeURIComponent(pdfRes.body.fileRef!)}?download=1`,
      { bearer: alice.accessToken, binary: true },
    );
    expect(dlGet.status).toBe(200);
    expect(dlGet.headers.get('content-disposition')).toContain('attachment;');
    expect(Buffer.compare(dlGet.rawBuffer!, Buffer.from(pdfBytes))).toBe(0);

    // -- AC: Text-file FTS indexing vs non-text image skipped --
    const pdfSearch = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?search=QuartzNebulaToken',
      { bearer: alice.accessToken },
    );
    expect(pdfSearch.body.items.map((b) => b.id)).toEqual([pdfRes.body.id]);

    const epubSearch = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?search=epubkeywordhyperion',
      { bearer: alice.accessToken },
    );
    expect(epubSearch.body.items.map((b) => b.id)).toEqual([epubRes.body.id]);

    const mdSearch = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?search=markdownuniquecipher',
      { bearer: alice.accessToken },
    );
    expect(mdSearch.body.items.map((b) => b.id)).toEqual([mdRes.body.id]);

    const txtSearch = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?search=plaincipheremerald',
      { bearer: alice.accessToken },
    );
    expect(txtSearch.body.items.map((b) => b.id)).toEqual([txtRes.body.id]);

    // Archived text accessible via GET /bookmarks/:id/archive; skipped image is 404
    const mdArchive = await call<{ text: string; html: string }>(
      baseUrl,
      'GET',
      `/bookmarks/${mdRes.body.id}/archive`,
      { bearer: alice.accessToken },
    );
    expect(mdArchive.status).toBe(200);
    expect(mdArchive.body.text).toContain('markdownuniquecipher');

    const imgArchive = await call(baseUrl, 'GET', `/bookmarks/${imgRes.body.id}/archive`, {
      bearer: alice.accessToken,
    });
    expect(imgArchive.status).toBe(404);

    // Non-text binary header ("IHDR" in PNG) is NOT searchable
    const imgBinarySearch = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?search=IHDR', {
      bearer: alice.accessToken,
    });
    expect(imgBinarySearch.body.items.map((b) => b.id)).not.toContain(imgRes.body.id);

    // -- AC: file: operator + ?file= + type= isolation; URL bookmarks unaffected --
    const fileTrue = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?search=file:true&pageSize=50',
      { bearer: alice.accessToken },
    );
    expect(fileTrue.body.items.map((b) => b.id).sort()).toEqual(
      [
        pdfRes.body.id,
        epubRes.body.id,
        mdRes.body.id,
        txtRes.body.id,
        imgRes.body.id,
        audioRes.body.id,
        videoRes.body.id,
      ].sort(),
    );

    const fileFalse = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?search=file:false', {
      bearer: alice.accessToken,
    });
    expect(fileFalse.body.items.map((b) => b.id)).toEqual([urlBm.body.id]);

    const restFileFilter = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?file=false', {
      bearer: alice.accessToken,
    });
    expect(restFileFilter.body.items.map((b) => b.id)).toEqual([urlBm.body.id]);

    const filePdfFilter = await call<BookmarkListView>(
      baseUrl,
      'GET',
      '/bookmarks?search=file:pdf',
      { bearer: alice.accessToken },
    );
    expect(filePdfFilter.body.items.map((b) => b.id)).toEqual([pdfRes.body.id]);

    const typeBook = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?type=book', {
      bearer: alice.accessToken,
    });
    expect(typeBook.body.items.map((b) => b.id)).toEqual([epubRes.body.id]);

    // Stats count active bookmarks (7 files + 1 URL = 8, docsCol has 1 -> 7 unassigned)
    const stats = await call<{
      total: number;
      unassigned: number;
      trashed: number;
      favorites: number;
    }>(baseUrl, 'GET', '/bookmarks/stats', { bearer: alice.accessToken });
    expect(stats.status).toBe(200);
    expect(stats.body).toEqual({ total: 8, unassigned: 7, trashed: 0, favorites: 1 });

    // Edit metadata succeeds on file items; changing url (400) and reindex (400) are refused
    const edited = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${imgRes.body.id}`, {
      bearer: alice.accessToken,
      body: { title: 'Renamed Pixel', note: 'Updated note' },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe('Renamed Pixel');

    const urlEditRefused = await call<Problem>(baseUrl, 'PUT', `/bookmarks/${imgRes.body.id}`, {
      bearer: alice.accessToken,
      body: { url: 'https://example.com/illegal' },
    });
    expect(urlEditRefused.status).toBe(400);

    const reindexRefused = await call<Problem>(
      baseUrl,
      'POST',
      `/bookmarks/${imgRes.body.id}/reindex`,
      { bearer: alice.accessToken },
    );
    expect(reindexRefused.status).toBe(400);

    // -- AC: Broken-link checker + Duplicates finder skip file items --
    // Upload a second identically named PNG — duplicates finder must STILL report 0 file groups
    const imgDup = await uploadMultipart(baseUrl, '/bookmarks/file', alice.accessToken, {
      name: 'pixel.png',
      mime: 'image/png',
      bytes: TINY_PNG,
    });
    expect(imgDup.status).toBe(201);
    const dupes = await call<{ groups: unknown[] }>(baseUrl, 'GET', '/library/duplicates', {
      bearer: alice.accessToken,
    });
    expect(dupes.status).toBe(200);
    expect(dupes.body.groups).toEqual([]);

    // Broken-links sweep only checks the single URL bookmark (never the 8 file items)
    await call(baseUrl, 'PUT', '/admin/settings', {
      bearer: admin.accessToken,
      body: { brokenLinkCheckMode: 'default' },
    });
    try {
      const sweep = await app.get(BrokenLinksService).sweep({
        jitterMinMs: 0,
        jitterMaxMs: 0,
        batchSize: 50,
      });
      // urlBm targets example.com with outbound disabled or DNS/SSRF policy; total url items = 1
      expect(sweep.checked + sweep.skipped).toBe(1);
    } finally {
      await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { brokenLinkCheckMode: 'off' },
      });
    }
    const pdfAfterSweep = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${pdfRes.body.id}`, {
      bearer: alice.accessToken,
    });
    expect(pdfAfterSweep.body.lastCheckedAt).toBeNull();
    expect(pdfAfterSweep.body.brokenAt).toBeNull();

    // -- AC: ZIP export (includeFiles=true) + manifest integrity + trash excluded + import skips files --
    // Trash imgDup so we also verify trashed files are NOT in the ZIP export
    expect(
      (await call(baseUrl, 'DELETE', `/bookmarks/${imgDup.body.id}`, { bearer: alice.accessToken }))
        .status,
    ).toBe(204);

    const zipRes = await call<Buffer>(baseUrl, 'POST', '/data/export', {
      bearer: alice.accessToken,
      body: { format: 'json', includeFiles: true },
      binary: true,
    });
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get('content-type')).toContain('application/zip');
    const zipEntries = readZipEntries(zipRes.rawBuffer!);
    const byEntryName = new Map(zipEntries.map((e) => [e.name, e.bytes]));

    const manifestRaw = byEntryName.get('manifest.json');
    const exportJsonRaw = byEntryName.get('export.json');
    expect(manifestRaw).toBeDefined();
    expect(exportJsonRaw).toBeDefined();

    const manifest = JSON.parse(manifestRaw!.toString('utf8')) as {
      format: string;
      fileCount: number;
      files: Array<{
        bookmarkId: string;
        fileName: string;
        fileMime: string;
        fileSize: number;
        archivePath: string;
        sha256: string;
      }>;
    };
    expect(manifest.format).toBe('arcdrop/export-bundle/v1');
    expect(manifest.fileCount).toBe(7); // imgDup is trashed so excluded
    const pdfManifestEntry = manifest.files.find((f) => f.bookmarkId === pdfRes.body.id)!;
    expect(pdfManifestEntry).toBeDefined();
    expect(pdfManifestEntry.sha256).toBe(createHash('sha256').update(pdfBytes).digest('hex'));
    const archivedPdf = byEntryName.get(pdfManifestEntry.archivePath)!;
    expect(archivedPdf).toBeDefined();
    expect(Buffer.compare(archivedPdf, Buffer.from(pdfBytes))).toBe(0);

    // Import the generated export.json into Bob's library: URL bookmark imports cleanly; 7 file items skip cleanly
    const reimport = await uploadMultipart<{
      created: number;
      updated: number;
      skipped: Array<{ reason: string }>;
      errors: unknown[];
    }>(baseUrl, '/data/import', bob.accessToken, {
      name: 'arcdrop-export.json',
      mime: 'application/json',
      bytes: exportJsonRaw!,
    });
    expect(reimport.status).toBe(200);
    expect(reimport.body.created).toBe(1);
    expect(reimport.body.skipped.length).toBe(7);
    expect(reimport.body.errors).toEqual([]);
  }, 30_000);

  it('AC: enforces per-file cap and monthly upload quota (413 with limitBytes/usedBytes/resetAt), leaves zero orphans, and resets on new month', async () => {
    const carol = await createUserViaAdmin(baseUrl, admin, 'carol-quota@arcdrop.test');
    const filesBefore = existsSync(filesDir()) ? readdirSync(filesDir()).length : 0;

    // 1. Per-file cap: tighten fileMaxBytes to 1024 -> 1500 B upload fails 413 PAYLOAD_TOO_LARGE
    const capRes = await call(baseUrl, 'PUT', '/admin/settings', {
      bearer: admin.accessToken,
      body: { fileMaxBytes: 1024, monthlyUploadQuotaBytes: 2048 },
    });
    expect(capRes.status).toBe(200);

    try {
      const tooBig = await uploadMultipart<Problem>(baseUrl, '/bookmarks/file', carol.accessToken, {
        name: 'big.txt',
        mime: 'text/plain',
        bytes: Buffer.alloc(1500, 'a'),
      });
      expect(tooBig.status).toBe(413);
      expect(tooBig.body.code).toBe('PAYLOAD_TOO_LARGE');
      expect(tooBig.body.limitBytes).toBe(1024);
      expect(readdirSync(filesDir()).length).toBe(filesBefore);

      // 2. Two 900 B uploads succeed (used = 1800 <= 2048)
      const u1 = await uploadMultipart(baseUrl, '/bookmarks/file', carol.accessToken, {
        name: 'part1.txt',
        mime: 'text/plain',
        bytes: Buffer.alloc(900, 'b'),
      });
      expect(u1.status).toBe(201);
      const u2 = await uploadMultipart(baseUrl, '/bookmarks/file', carol.accessToken, {
        name: 'part2.txt',
        mime: 'text/plain',
        bytes: Buffer.alloc(900, 'c'),
      });
      expect(u2.status).toBe(201);

      const countAfterAllowed = readdirSync(filesDir()).length;

      // 3. Third 500 B upload crosses 2048 -> 413 UPLOAD_QUOTA_EXCEEDED with retry metadata & zero orphans
      const overQuota = await uploadMultipart<Problem>(
        baseUrl,
        '/bookmarks/file',
        carol.accessToken,
        {
          name: 'part3.txt',
          mime: 'text/plain',
          bytes: Buffer.alloc(500, 'd'),
        },
      );
      expect(overQuota.status).toBe(413);
      expect(overQuota.body.code).toBe('UPLOAD_QUOTA_EXCEEDED');
      expect(overQuota.body.limitBytes).toBe(2048);
      expect(overQuota.body.usedBytes).toBe(1800);
      expect(overQuota.body.resetAt).toBeDefined();
      expect(readdirSync(filesDir()).length).toBe(countAfterAllowed);

      // 4. Backdate carol's upload_usage row to an earlier month -> next month resets quota!
      await dataSource.query(`UPDATE upload_usage SET month = '2025-01' WHERE user_id = $1`, [
        carol.user.id,
      ]);
      const afterRollover = await uploadMultipart(baseUrl, '/bookmarks/file', carol.accessToken, {
        name: 'next-month.txt',
        mime: 'text/plain',
        bytes: Buffer.alloc(500, 'e'),
      });
      expect(afterRollover.status).toBe(201);
    } finally {
      await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: {
          fileMaxBytes: DEFAULT_FILE_MAX_BYTES,
          monthlyUploadQuotaBytes: DEFAULT_MONTHLY_UPLOAD_QUOTA_BYTES,
        },
      });
    }
  });

  it('AC: trash preserves file bytes until restore/purge; purge, bulk delete, reset-data, and orphan eviction delete volume + archive files', async () => {
    const dave = await createUserViaAdmin(baseUrl, admin, 'dave-purge@arcdrop.test');

    // Upload A (bulk hard delete), B (retention purge), C (keep for restore + reset-data verification)
    const [upA, upB, upC] = await Promise.all([
      uploadMultipart(baseUrl, '/bookmarks/file', dave.accessToken, {
        name: 'a-bulk.md',
        mime: 'text/markdown',
        bytes: Buffer.from('# Alpha bulk delete target', 'utf8'),
      }),
      uploadMultipart(baseUrl, '/bookmarks/file', dave.accessToken, {
        name: 'b-purge.txt',
        mime: 'text/plain',
        bytes: Buffer.from('Beta retention purge target', 'utf8'),
      }),
      uploadMultipart(baseUrl, '/bookmarks/file', dave.accessToken, {
        name: 'c-restore.txt',
        mime: 'text/plain',
        bytes: Buffer.from('Gamma restore keep target', 'utf8'),
      }),
    ]);
    expect(upA.status).toBe(201);
    expect(upB.status).toBe(201);
    expect(upC.status).toBe(201);

    const pathA = join(filesDir(), upA.body.fileRef!);
    const pathB = join(filesDir(), upB.body.fileRef!);
    const pathC = join(filesDir(), upC.body.fileRef!);
    expect(existsSync(pathA)).toBeTrue();
    expect(existsSync(join(archiveDirOf(upA.body.id), 'content.txt'))).toBeTrue();

    // Trash C and restore C -> file bytes stay intact and readable
    expect(
      (await call(baseUrl, 'DELETE', `/bookmarks/${upC.body.id}`, { bearer: dave.accessToken }))
        .status,
    ).toBe(204);
    expect(existsSync(pathC)).toBeTrue();
    expect(
      (
        await call(baseUrl, 'POST', `/bookmarks/${upC.body.id}/restore`, {
          bearer: dave.accessToken,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(baseUrl, 'GET', `/files/${upC.body.id}`, { bearer: dave.accessToken })).status,
    ).toBe(200);

    // Trash A then hard delete via /bookmarks/bulk delete -> file bytes + archive removed
    expect(
      (await call(baseUrl, 'DELETE', `/bookmarks/${upA.body.id}`, { bearer: dave.accessToken }))
        .status,
    ).toBe(204);
    const bulkDel = await call(baseUrl, 'POST', '/bookmarks/bulk', {
      bearer: dave.accessToken,
      body: { action: 'delete', ids: [upA.body.id] },
    });
    expect(bulkDel.status).toBe(200);
    await waitFor(5_000, () => !existsSync(pathA) && !existsSync(archiveDirOf(upA.body.id)));
    expect(existsSync(pathA)).toBeFalse();
    expect(existsSync(archiveDirOf(upA.body.id))).toBeFalse();

    // Trash B, backdate deleted_at past retention window, run TrashPurgeService.purgeExpired()
    expect(
      (await call(baseUrl, 'DELETE', `/bookmarks/${upB.body.id}`, { bearer: dave.accessToken }))
        .status,
    ).toBe(204);
    await dataSource.query(
      `UPDATE bookmarks SET deleted_at = NOW() - INTERVAL '400 days' WHERE id = $1`,
      [upB.body.id],
    );
    await app.get(TrashPurgeService).purgeExpired();
    await waitFor(5_000, () => !existsSync(pathB) && !existsSync(archiveDirOf(upB.body.id)));
    expect(existsSync(pathB)).toBeFalse();
    expect(existsSync(archiveDirOf(upB.body.id))).toBeFalse();
    expect(existsSync(pathC)).toBeTrue(); // untouched

    // Orphaned file matching valid ref pattern is swept by FileEvictionService; referenced file untouched
    const orphanRef = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.txt';
    const orphanPath = join(filesDir(), orphanRef);
    writeFileSync(orphanPath, 'stray-orphan');
    const eviction = await app.get(FileEvictionService).evictOrphaned();
    expect(eviction.evicted).toBeGreaterThanOrEqual(1);
    expect(existsSync(orphanPath)).toBeFalse();
    expect(existsSync(pathC)).toBeTrue();

    // Account data reset deletes dave's remaining file bytes & archive, while preserving upload_usage
    const reset = await call(baseUrl, 'POST', '/me/reset-data', {
      bearer: dave.accessToken,
      body: { password: 'user-password-1' },
    });
    expect(reset.status).toBe(204);
    await waitFor(5_000, () => !existsSync(pathC) && !existsSync(archiveDirOf(upC.body.id)));
    expect(existsSync(pathC)).toBeFalse();
    expect(existsSync(archiveDirOf(upC.body.id))).toBeFalse();
    const usageRows = (await dataSource.query(
      'SELECT bytes_used FROM upload_usage WHERE user_id = $1',
      [dave.user.id],
    )) as Array<{ bytes_used: string }>;
    expect(usageRows.length).toBe(1);
    expect(Number(usageRows[0]!.bytes_used)).toBeGreaterThan(0);
  });

  it('AC: MCP tools uploadBookmarkFile (1 MiB cap) and getFile round-trip bytes with ownership scoping', async () => {
    const patRes = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
      bearer: alice.accessToken,
      body: { name: 'file-mcp-rw', readOnly: false },
    });
    expect(patRes.status).toBe(201);

    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/v1/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${patRes.body.token}` } },
    });
    const mcp = new Client({ name: 'm18-mcp-e2e', version: '1.0.0' });
    await mcp.connect(transport);
    try {
      const content = 'MCP uploaded markdown with token mcpxenonquartz.';
      const uploaded = await mcp.callTool({
        name: 'uploadBookmarkFile',
        arguments: {
          fileName: 'mcp-note.md',
          mimeType: 'text/markdown',
          data: Buffer.from(content, 'utf8').toString('base64'),
          title: 'MCP Note File',
        },
      });
      expect(uploaded.isError).toBeFalsy();
      const bm = uploaded.structuredContent as BookmarkView;
      expect(bm.storageKind).toBe('file');
      expect(bm.fileMime).toBe('text/markdown');
      expect(bm.cacheStatus).toBe('ready');

      const fetched = await mcp.callTool({
        name: 'getFile',
        arguments: { id: bm.id },
      });
      expect(fetched.isError).toBeFalsy();
      const filePayload = fetched.structuredContent as {
        bookmarkId: string;
        fileName: string;
        data: string;
      };
      expect(filePayload.bookmarkId).toBe(bm.id);
      expect(Buffer.from(filePayload.data, 'base64').toString('utf8')).toBe(content);

      // Decoded payload = 1,048,577 bytes (passes base64 length limit, breaches 1 MiB decoded cap) -> 413 tool error
      const tooBigMcp = await mcp.callTool({
        name: 'uploadBookmarkFile',
        arguments: {
          fileName: 'big.txt',
          mimeType: 'text/plain',
          data: Buffer.alloc(1_048_577, 'x').toString('base64'),
        },
      });
      expect(tooBigMcp.isError).toBe(true);
      expect((tooBigMcp.content as Array<{ text: string }>)[0]?.text).toContain('413');

      // Large file uploaded over REST omits inline `data` on MCP `getFile` with helpful `_note`
      const largeRest = await uploadMultipart(baseUrl, '/bookmarks/file', alice.accessToken, {
        name: 'over-1mib.txt',
        mime: 'text/plain',
        bytes: Buffer.alloc(1_048_577, 'y'),
      });
      expect(largeRest.status).toBe(201);
      const bigMeta = await mcp.callTool({
        name: 'getFile',
        arguments: { id: largeRest.body.id },
      });
      expect(bigMeta.isError).toBeFalsy();
      const bigPayload = bigMeta.structuredContent as { data?: string; _note?: string };
      expect(bigPayload.data).toBeUndefined();
      expect(bigPayload._note).toContain('GET /api/v1/files/');
    } finally {
      await mcp.close();
    }
  });
});
