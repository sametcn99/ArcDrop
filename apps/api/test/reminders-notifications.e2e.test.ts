import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { WebSocket as WsClient } from 'ws';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { RemindersJob } from '../src/notifications/reminders.job';
import { RemindersService } from '../src/notifications/reminders.service';
import { installTestEnv } from './helpers';

/**
 * M14 — Reminders & notifications (plan D19, D20 — WS-only delivery, no SMTP)
 *
 * Real HTTP + real WebSocket + real MCP + real Postgres e2e suite covering:
 * - Live WS reminder delivery + NotificationOutbox persistence
 * - Exactly-once firing under concurrent/double-run minute-job execution
 * - Offline device catch-up (`GET /notifications?unread=true`, paging, `POST /notifications/read`)
 * - Cancel paths: clearing `reminderAt: null`, single trash, bulk trash, hard delete
 * - PUT idempotency & re-arming + UTC storage/local-time OpenAPI contract
 * - Disabled users' reminders skipped
 * - `reminder=true|false` list filter + `reminder:true|false` / `-reminder:true` search operator
 * - Cross-user isolation (REST inbox, mark-read, WS rooms)
 * - MCP tools parity (`listNotifications`, `markNotificationsRead`, `updateBookmark`, `listBookmarks`)
 * - D20 negative: zero SMTP / email delivery paths in `src/`
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
  reminderAt: string | null;
  remindedAt: string | null;
  deletedAt: string | null;
}

interface BookmarkListView {
  items: BookmarkView[];
  totalCount: number;
  page: number;
  pageSize: number;
}

interface NotificationView {
  id: string;
  type: 'reminder';
  bookmarkId: string | null;
  payload: {
    bookmarkId: string;
    title: string | null;
    url: string;
    reminderAt: string;
  };
  createdAt: string;
  readAt: string | null;
}

interface NotificationListView {
  items: NotificationView[];
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface WsFrame {
  type?: string;
  bookmarkId?: string;
  title?: string | null;
  seq?: string;
  entity?: string;
  id?: string;
  action?: string;
}

interface SyncSocket {
  client: WsClient;
  opened: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  messages: WsFrame[];
}

async function connectWs(baseUrl: string, bearer: string): Promise<SyncSocket> {
  const ticketRes = await call<{ ticket: string }>(baseUrl, 'POST', '/sync/ticket', { bearer });
  expect(ticketRes.status).toBe(201);
  const url = `${baseUrl.replace(/^http/, 'ws')}/api/v1/sync/ws?ticket=${encodeURIComponent(ticketRes.body.ticket)}`;
  const client = new WsClient(url);
  const socket: SyncSocket = {
    client,
    opened: new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', (err) => reject(err));
    }),
    closed: new Promise((resolve) => {
      client.once('close', (code, reason) => resolve({ code, reason: reason?.toString() ?? '' }));
    }),
    messages: [],
  };
  client.on('message', (data) => {
    try {
      socket.messages.push(JSON.parse(data.toString()) as WsFrame);
    } catch {
      // ignore non-JSON frames
    }
  });
  client.on('error', () => {});
  await socket.opened;
  return socket;
}

async function waitForReminderFrame(
  socket: SyncSocket,
  bookmarkId: string,
  expectedCount = 1,
  timeoutMs = 3000,
): Promise<WsFrame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = socket.messages.filter(
      (m) => m.type === 'reminder' && m.bookmarkId === bookmarkId,
    );
    if (matches.length >= expectedCount) return matches[expectedCount - 1]!;
    await sleep(20);
  }
  throw new Error(
    `expected ${expectedCount} reminder ws frame(s) for ${bookmarkId} did not arrive within ${timeoutMs}ms`,
  );
}

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

describe('Reminders & notifications M14 (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let document: OpenAPIObject;
  let remindersService: RemindersService;
  let remindersJob: RemindersJob;

  let admin: AuthSession;
  let alice: AuthSession;
  let bob: AuthSession;
  let charlie: AuthSession;

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
    remindersService = app.get(RemindersService);
    remindersJob = app.get(RemindersJob);
    await wipeData(dataSource);

    const boot = await call<AuthSession>(baseUrl, 'POST', '/auth/bootstrap', {
      body: { email: 'admin-m14@arcdrop.test', password: 'root-password-1' },
    });
    expect(boot.status).toBe(201);
    admin = boot.body;

    alice = await createUserViaAdmin(baseUrl, admin, 'alice-m14@arcdrop.test');
    bob = await createUserViaAdmin(baseUrl, admin, 'bob-m14@arcdrop.test');
    charlie = await createUserViaAdmin(baseUrl, admin, 'charlie-m14@arcdrop.test');
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await app.close();
  });

  it('D20 negative & OpenAPI contract: no SMTP anywhere; UTC/local docs and operationIds published', () => {
    const srcDir = join(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const text = readFileSync(full, 'utf8');
          if (/nodemailer|createTransport|SmtpConfig/i.test(text)) {
            offenders.push(full);
          }
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);

    expect(document.paths['/api/v1/notifications']?.get?.operationId).toBe('listNotifications');
    expect(document.paths['/api/v1/notifications/read']?.post?.operationId).toBe(
      'markNotificationsRead',
    );
    const bookmarkSchema = document.components?.schemas?.['BookmarkDto'] as {
      properties?: Record<string, { description?: string }>;
    };
    expect(bookmarkSchema.properties?.['reminderAt']?.description).toContain('UTC');
    expect(bookmarkSchema.properties?.['reminderAt']?.description).toContain('local');
    expect(bookmarkSchema.properties?.['remindedAt']).toBeDefined();
  });

  it('AC1: sets reminder 2s out with open ws → delivers live frame + outbox row, exactly-once under concurrent double-run', async () => {
    const aliceWs = await connectWs(baseUrl, alice.accessToken);
    const bobWs = await connectWs(baseUrl, bob.accessToken);

    const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://example.com/remind-live', title: 'Live Reminder Article' },
    });
    expect(created.status).toBe(201);
    expect(created.body.reminderAt).toBeNull();
    expect(created.body.remindedAt).toBeNull();

    const syncBefore = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });

    const fireAt = new Date(Date.now() + 2000).toISOString();
    const updated = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${created.body.id}`, {
      bearer: alice.accessToken,
      body: { reminderAt: fireAt },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.reminderAt).toBe(fireAt);
    expect(updated.body.remindedAt).toBeNull();

    // Verify setting reminderAt was change-logged.
    const syncAfterSet = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
      bearer: alice.accessToken,
    });
    expect(BigInt(syncAfterSet.body.seq)).toBe(BigInt(syncBefore.body.seq) + 1n);

    // Before fireAt elapses: due sweep fires nothing.
    expect(await remindersService.processDueReminders()).toEqual({ fired: 0 });

    // Wait past the 2s deadline.
    await sleep(2200);

    // Concurrent double-run AND sequential re-run MUST fire strictly once.
    const [runA, runB] = await Promise.all([
      remindersService.processDueReminders(),
      remindersService.processDueReminders(),
    ]);
    expect(runA.fired + runB.fired).toBe(1);
    expect(await remindersService.processDueReminders()).toEqual({ fired: 0 });
    await remindersJob.handle();

    // Live ws frame arrived for Alice, and ONLY once.
    const frame = await waitForReminderFrame(aliceWs, created.body.id);
    expect(frame).toEqual({
      type: 'reminder',
      bookmarkId: created.body.id,
      title: 'Live Reminder Article',
    });
    const reminderFrames = aliceWs.messages.filter(
      (m) => m.type === 'reminder' && m.bookmarkId === created.body.id,
    );
    expect(reminderFrames).toHaveLength(1);

    // Cross-user isolation: Bob's ws received nothing.
    await sleep(150);
    expect(bobWs.messages).toHaveLength(0);

    // Bookmark now carries remindedAt and fired change event.
    const afterFire = await call<BookmarkView>(baseUrl, 'GET', `/bookmarks/${created.body.id}`, {
      bearer: alice.accessToken,
    });
    expect(afterFire.status).toBe(200);
    expect(afterFire.body.remindedAt).not.toBeNull();

    // Outbox holds exactly one durable row.
    const inbox = await call<NotificationListView>(baseUrl, 'GET', '/notifications?unread=true', {
      bearer: alice.accessToken,
    });
    expect(inbox.status).toBe(200);
    expect(inbox.body.totalCount).toBe(1);
    expect(inbox.body.items[0]).toMatchObject({
      type: 'reminder',
      bookmarkId: created.body.id,
      readAt: null,
      payload: {
        bookmarkId: created.body.id,
        title: 'Live Reminder Article',
        url: 'https://example.com/remind-live',
        reminderAt: fireAt,
      },
    });

    // PUT idempotency: resending the same reminderAt after fire does NOT re-arm it.
    const resendSame = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${created.body.id}`, {
      bearer: alice.accessToken,
      body: { reminderAt: fireAt, title: 'Updated Title Only' },
    });
    expect(resendSame.status).toBe(200);
    expect(resendSame.body.remindedAt).toBe(afterFire.body.remindedAt);
    expect(await remindersService.processDueReminders()).toEqual({ fired: 0 });

    // Setting a NEW reminderAt re-arms it as a fresh one-time reminder.
    const secondFireAt = new Date(Date.now() - 500).toISOString();
    const rearmed = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${created.body.id}`, {
      bearer: alice.accessToken,
      body: { reminderAt: secondFireAt },
    });
    expect(rearmed.status).toBe(200);
    expect(rearmed.body.remindedAt).toBeNull();
    expect(await remindersService.processDueReminders()).toEqual({ fired: 1 });
    const secondFrame = await waitForReminderFrame(aliceWs, created.body.id, 2);
    expect(secondFrame.title).toBe('Updated Title Only');
    expect(
      aliceWs.messages.filter((m) => m.type === 'reminder' && m.bookmarkId === created.body.id),
    ).toHaveLength(2);

    aliceWs.client.close(1000, 'done');
    bobWs.client.close(1000, 'done');
    await Promise.all([aliceWs.closed, bobWs.closed]);
  });

  it('AC2: offline device catch-up, paging, mark-read (ids & all), and cross-user isolation', async () => {
    // Clear Alice's prior notifications cleanly or mark all read first so counts are deterministic.
    await call(baseUrl, 'POST', '/notifications/read', {
      bearer: alice.accessToken,
      body: { all: true },
    });

    // Create 3 due reminders for Bob while Bob has NO ws connection.
    const bobBookIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const bm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: bob.accessToken,
        body: {
          url: `https://example.com/bob-offline-${i}`,
          title: `Bob Offline ${i}`,
          reminderAt: new Date(Date.now() - 10_000 + i * 1000).toISOString(),
        },
      });
      expect(bm.status).toBe(201);
      bobBookIds.push(bm.body.id);
    }

    expect(await remindersService.processDueReminders()).toEqual({ fired: 3 });

    // Offline Bob catches up via GET /notifications?unread=true (with paging).
    const page1 = await call<NotificationListView>(
      baseUrl,
      'GET',
      '/notifications?unread=true&page=1&pageSize=2',
      { bearer: bob.accessToken },
    );
    expect(page1.status).toBe(200);
    expect(page1.body.totalCount).toBe(3);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(2);
    expect(page1.body.items).toHaveLength(2);

    const page2 = await call<NotificationListView>(
      baseUrl,
      'GET',
      '/notifications?unread=true&page=2&pageSize=2',
      { bearer: bob.accessToken },
    );
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);

    // Clamping pageSize above 200.
    const clamped = await call<NotificationListView>(
      baseUrl,
      'GET',
      '/notifications?pageSize=999',
      { bearer: bob.accessToken },
    );
    expect(clamped.status).toBe(200);
    expect(clamped.body.pageSize).toBe(200);

    // Alice cannot mark Bob's notification as read (cross-user isolation).
    const firstBobNotifId = page1.body.items[0]!.id;
    const crossRead = await call<{ updated: number }>(baseUrl, 'POST', '/notifications/read', {
      bearer: alice.accessToken,
      body: { ids: [firstBobNotifId] },
    });
    expect(crossRead.status).toBe(200);
    expect(crossRead.body).toEqual({ updated: 0 });

    // Bob marks the first notification read by id.
    const markOne = await call<{ updated: number }>(baseUrl, 'POST', '/notifications/read', {
      bearer: bob.accessToken,
      body: { ids: [firstBobNotifId] },
    });
    expect(markOne.status).toBe(200);
    expect(markOne.body).toEqual({ updated: 1 });

    // Idempotent re-call returns updated: 0.
    const markOneAgain = await call<{ updated: number }>(baseUrl, 'POST', '/notifications/read', {
      bearer: bob.accessToken,
      body: { ids: [firstBobNotifId] },
    });
    expect(markOneAgain.status).toBe(200);
    expect(markOneAgain.body).toEqual({ updated: 0 });

    // unread=true now has 2; unread=false has 1.
    const unreadAfter = await call<NotificationListView>(
      baseUrl,
      'GET',
      '/notifications?unread=true',
      { bearer: bob.accessToken },
    );
    expect(unreadAfter.body.totalCount).toBe(2);
    const readAfter = await call<NotificationListView>(
      baseUrl,
      'GET',
      '/notifications?unread=false',
      { bearer: bob.accessToken },
    );
    expect(readAfter.body.totalCount).toBe(1);
    expect(readAfter.body.items[0]!.id).toBe(firstBobNotifId);
    expect(readAfter.body.items[0]!.readAt).not.toBeNull();

    // Mark remaining unread notifications via all: true.
    const markAll = await call<{ updated: number }>(baseUrl, 'POST', '/notifications/read', {
      bearer: bob.accessToken,
      body: { all: true },
    });
    expect(markAll.status).toBe(200);
    expect(markAll.body).toEqual({ updated: 2 });

    const markAllAgain = await call<{ updated: number }>(baseUrl, 'POST', '/notifications/read', {
      bearer: bob.accessToken,
      body: { all: true },
    });
    expect(markAllAgain.body).toEqual({ updated: 0 });

    // Validation errors -> 400 problem+json
    const badEmpty = await call(baseUrl, 'POST', '/notifications/read', {
      bearer: bob.accessToken,
      body: {},
    });
    expect(badEmpty.status).toBe(400);
    expect(badEmpty.contentType).toContain('application/problem+json');
    expect(problem(badEmpty).code).toBe('BAD_REQUEST');

    const badBoth = await call(baseUrl, 'POST', '/notifications/read', {
      bearer: bob.accessToken,
      body: { ids: [firstBobNotifId], all: true },
    });
    expect(badBoth.status).toBe(400);
  });

  it('AC3: clearing reminderAt, trashing (single/bulk), and deleting cancel pending fire; trashed bookmarks never fire', async () => {
    const pastIso = new Date(Date.now() - 5000).toISOString();

    // 1. Cleared via PUT reminderAt: null
    const clearedBm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://example.com/cleared', title: 'Cleared Reminder', reminderAt: pastIso },
    });
    const clearedPut = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${clearedBm.body.id}`, {
      bearer: alice.accessToken,
      body: { reminderAt: null },
    });
    expect(clearedPut.status).toBe(200);
    expect(clearedPut.body.reminderAt).toBeNull();
    expect(clearedPut.body.remindedAt).toBeNull();

    // 2. Single-trashed via DELETE
    const trashedBm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: { url: 'https://example.com/trashed', title: 'Trashed Reminder', reminderAt: pastIso },
    });
    expect(
      (
        await call(baseUrl, 'DELETE', `/bookmarks/${trashedBm.body.id}`, {
          bearer: alice.accessToken,
        })
      ).status,
    ).toBe(204);

    // 3. Bulk-trashed via POST /bookmarks/bulk
    const bulkTrashedBm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: {
        url: 'https://example.com/bulk-trashed',
        title: 'Bulk Trashed Reminder',
        reminderAt: pastIso,
      },
    });
    expect(
      (
        await call(baseUrl, 'POST', '/bookmarks/bulk', {
          bearer: alice.accessToken,
          body: { action: 'trash', ids: [bulkTrashedBm.body.id] },
        })
      ).status,
    ).toBe(200);

    // 4. Hard-deleted via trash + bulk delete
    const hardDeletedBm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: alice.accessToken,
      body: {
        url: 'https://example.com/hard-deleted',
        title: 'Hard Deleted Reminder',
        reminderAt: pastIso,
      },
    });
    await call(baseUrl, 'DELETE', `/bookmarks/${hardDeletedBm.body.id}`, {
      bearer: alice.accessToken,
    });
    await call(baseUrl, 'POST', '/bookmarks/bulk', {
      bearer: alice.accessToken,
      body: { action: 'delete', ids: [hardDeletedBm.body.id] },
    });

    // Sweep must fire ZERO of these.
    expect(await remindersService.processDueReminders()).toEqual({ fired: 0 });

    // Restoring trashedBm lets its still-pending reminder fire cleanly.
    const restored = await call<BookmarkView>(
      baseUrl,
      'POST',
      `/bookmarks/${trashedBm.body.id}/restore`,
      { bearer: alice.accessToken },
    );
    expect(restored.status).toBe(200);
    expect(await remindersService.processDueReminders()).toEqual({ fired: 1 });

    // Hard-deleting a bookmark that ALREADY produced an outbox row retains the outbox history (bookmarkId -> null).
    await call(baseUrl, 'DELETE', `/bookmarks/${trashedBm.body.id}`, {
      bearer: alice.accessToken,
    });
    await call(baseUrl, 'POST', '/bookmarks/bulk', {
      bearer: alice.accessToken,
      body: { action: 'delete', ids: [trashedBm.body.id] },
    });
    const inbox = await call<NotificationListView>(baseUrl, 'GET', '/notifications?unread=true', {
      bearer: alice.accessToken,
    });
    const orphanHistory = inbox.body.items.find((n) => n.payload.bookmarkId === trashedBm.body.id);
    expect(orphanHistory).toBeDefined();
    expect(orphanHistory!.bookmarkId).toBeNull();
    expect(orphanHistory!.payload.title).toBe('Trashed Reminder');
  });

  it('AC4: disabled users’ due reminders are skipped', async () => {
    const ws = await connectWs(baseUrl, charlie.accessToken);
    const charlieBm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: charlie.accessToken,
      body: {
        url: 'https://example.com/charlie-disabled',
        title: 'Charlie Disabled Reminder',
        reminderAt: new Date(Date.now() - 2000).toISOString(),
      },
    });
    expect(charlieBm.status).toBe(201);

    // Admin disables Charlie before sweep runs.
    const disabled = await call(baseUrl, 'PATCH', `/admin/users/${charlie.user.id}`, {
      bearer: admin.accessToken,
      body: { status: 'disabled' },
    });
    expect(disabled.status).toBe(200);

    expect(await remindersService.processDueReminders()).toEqual({ fired: 0 });
    await sleep(150);
    expect(ws.messages.filter((m) => m.type === 'reminder')).toHaveLength(0);

    const outboxCount = (await dataSource.query(
      'SELECT COUNT(*)::int AS cnt FROM notification_outbox WHERE user_id = $1',
      [charlie.user.id],
    )) as Array<{ cnt: number }>;
    expect(outboxCount[0]!.cnt).toBe(0);

    // Re-enabling Charlie lets the due reminder fire normally.
    await call(baseUrl, 'PATCH', `/admin/users/${charlie.user.id}`, {
      bearer: admin.accessToken,
      body: { status: 'active' },
    });
    expect(await remindersService.processDueReminders()).toEqual({ fired: 1 });
    await waitForReminderFrame(ws, charlieBm.body.id);

    ws.client.close(1000, 'done');
    await ws.closed;
  });

  it('AC5: reminder=true|false filter and reminder:true|false / -reminder:true grammar + UTC offset normalization', async () => {
    const user = await createUserViaAdmin(baseUrl, admin, 'filter-m14@arcdrop.test');

    // Timezone offset input (+03:00) normalizes to UTC storage.
    const withReminder = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: user.accessToken,
      body: {
        url: 'https://example.com/with-reminder',
        title: 'Has Reminder',
        reminderAt: '2099-06-15T13:00:00+03:00',
      },
    });
    expect(withReminder.status).toBe(201);
    expect(withReminder.body.reminderAt).toBe('2099-06-15T10:00:00.000Z');

    const withoutReminder = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: user.accessToken,
      body: { url: 'https://example.com/no-reminder', title: 'No Reminder' },
    });
    expect(withoutReminder.status).toBe(201);

    const clearedReminder = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: user.accessToken,
      body: {
        url: 'https://example.com/cleared-filter',
        title: 'Cleared Filter',
        reminderAt: '2099-06-15T10:00:00Z',
      },
    });
    await call(baseUrl, 'PUT', `/bookmarks/${clearedReminder.body.id}`, {
      bearer: user.accessToken,
      body: { reminderAt: null },
    });

    // REST filter reminder=true / reminder=false
    const fTrue = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?reminder=true', {
      bearer: user.accessToken,
    });
    expect(fTrue.status).toBe(200);
    expect(fTrue.body.items.map((b) => b.id)).toEqual([withReminder.body.id]);

    const fFalse = await call<BookmarkListView>(baseUrl, 'GET', '/bookmarks?reminder=false', {
      bearer: user.accessToken,
    });
    expect(fFalse.status).toBe(200);
    expect(fFalse.body.items.map((b) => b.id).sort()).toEqual(
      [withoutReminder.body.id, clearedReminder.body.id].sort(),
    );

    // Grammar operator reminder:true / reminder:false / -reminder:true
    const opTrue = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('reminder:true')}`,
      { bearer: user.accessToken },
    );
    expect(opTrue.status).toBe(200);
    expect(opTrue.body.items.map((b) => b.id)).toEqual([withReminder.body.id]);

    const opFalse = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?q=${encodeURIComponent('reminder:false')}`,
      { bearer: user.accessToken },
    );
    expect(opFalse.status).toBe(200);
    expect(opFalse.body.items.map((b) => b.id).sort()).toEqual(
      [withoutReminder.body.id, clearedReminder.body.id].sort(),
    );

    const opNeg = await call<BookmarkListView>(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('-reminder:true')}`,
      { bearer: user.accessToken },
    );
    expect(opNeg.status).toBe(200);
    expect(opNeg.body.items.map((b) => b.id).sort()).toEqual(
      [withoutReminder.body.id, clearedReminder.body.id].sort(),
    );

    // Invalid value returns 400 BAD_REQUEST
    const invalidOp = await call(
      baseUrl,
      'GET',
      `/bookmarks?search=${encodeURIComponent('reminder:tomorrow')}`,
      { bearer: user.accessToken },
    );
    expect(invalidOp.status).toBe(400);
    expect(problem(invalidOp).code).toBe('BAD_REQUEST');
  });

  it('AC6: MCP parity for listNotifications, markNotificationsRead, updateBookmark reminderAt, and read-only PAT gates', async () => {
    const user = await createUserViaAdmin(baseUrl, admin, 'mcp-m14@arcdrop.test');
    const rwPat = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
      bearer: user.accessToken,
      body: { name: 'M14 RW', readOnly: false },
    });
    const roPat = await call<{ token: string }>(baseUrl, 'POST', '/me/tokens', {
      bearer: user.accessToken,
      body: { name: 'M14 RO', readOnly: true },
    });

    const bm = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
      bearer: user.accessToken,
      body: { url: 'https://example.com/mcp-reminder', title: 'MCP Reminder' },
    });

    const rwInit = await mcpPost(baseUrl, rwPat.body.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'm14-rw', version: '0.0.0' },
      },
    });
    const rwSession = rwInit.sessionId!;

    // Set reminderAt via MCP updateBookmark
    const setRes = await mcpPost(
      baseUrl,
      rwPat.body.token,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'updateBookmark',
          arguments: {
            id: bm.body.id,
            reminderAt: new Date(Date.now() - 1000).toISOString(),
          },
        },
      },
      rwSession,
    );
    expect(setRes.message?.error).toBeUndefined();
    expect(
      (setRes.message?.result?.['structuredContent'] as { reminderAt: string | null }).reminderAt,
    ).not.toBeNull();

    // Filter via MCP listBookmarks
    const listedBm = await mcpPost(
      baseUrl,
      rwPat.body.token,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'listBookmarks',
          arguments: { reminder: true, search: 'reminder:true' },
        },
      },
      rwSession,
    );
    expect(
      (
        listedBm.message?.result?.['structuredContent'] as { items: Array<{ id: string }> }
      ).items.map((i) => i.id),
    ).toEqual([bm.body.id]);

    expect(await remindersService.processDueReminders()).toEqual({ fired: 1 });

    // Read-only PAT can listNotifications
    const roInit = await mcpPost(baseUrl, roPat.body.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'm14-ro', version: '0.0.0' },
      },
    });
    const roSession = roInit.sessionId!;

    const roList = await mcpPost(
      baseUrl,
      roPat.body.token,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'listNotifications', arguments: { unread: true } },
      },
      roSession,
    );
    expect(roList.message?.error).toBeUndefined();
    const roItems = (roList.message?.result?.['structuredContent'] as { items: NotificationView[] })
      .items;
    expect(roItems).toHaveLength(1);

    // Read-only PAT is refused on markNotificationsRead
    const roMark = await mcpPost(
      baseUrl,
      roPat.body.token,
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'markNotificationsRead', arguments: { all: true } },
      },
      roSession,
    );
    expect(roMark.message?.result?.['isError']).toBe(true);

    // Read-write PAT marks read via MCP markNotificationsRead
    const rwMark = await mcpPost(
      baseUrl,
      rwPat.body.token,
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'markNotificationsRead', arguments: { ids: [roItems[0]!.id] } },
      },
      rwSession,
    );
    expect(rwMark.message?.error).toBeUndefined();
    expect(rwMark.message?.result?.['structuredContent']).toEqual({ updated: 1 });
  });
});
