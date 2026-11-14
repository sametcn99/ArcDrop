import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { WebSocket as WsClient } from 'ws';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { createDataSource } from '../src/database/data-source';
import { loadConfig } from '../src/config/load-config';
import { ChangeLogRetentionService } from '../src/sync/change-log-retention.service';
import { SyncTicketService } from '../src/sync/sync-ticket.service';
import { installTestEnv } from './helpers';

/**
 * M5 sync integration e2e (plan M5, D4) — real HTTP + real websockets
 * against real Postgres. Covers the ticket's acceptance criteria:
 * two-device ws convergence with a cursor delta pull, offline
 * reconstruction from `since=0` (snapshots + tombstones, multi-event
 * mutations in seq order), deep-offline `resyncRequired`, every ticket
 * rejection path, cross-user isolation, and retention compaction that
 * never breaks live cursors.
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
  urlParts: UrlPartsView;
  tags: TagView[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface ChangeNotification {
  seq: string;
  entity: 'bookmark' | 'tag' | 'collection';
  id: string;
  action: 'create' | 'update' | 'delete';
}

interface TagSnapshotView {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface CollectionSnapshotView {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  color: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface ChangeView extends ChangeNotification {
  snapshot: BookmarkView | TagSnapshotView | CollectionSnapshotView | null;
}

interface ChangesView {
  resyncRequired: boolean;
  changes: ChangeView[];
  cursor: string;
}

interface StateView {
  seq: string;
}

interface TicketView {
  ticket: string;
  expiresAt: string;
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
  // Order respects FKs; CASCADE would cover most of it but be explicit.
  await dataSource.query('DELETE FROM change_events');
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

// -- websocket helpers -------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function syncWsUrl(baseUrl: string, ticket?: string): string {
  const base = `${baseUrl}`.replace(/^http/, 'ws');
  const path = '/api/v1/sync/ws';
  return ticket === undefined
    ? `${base}${path}`
    : `${base}${path}?ticket=${encodeURIComponent(ticket)}`;
}

interface SyncSocket {
  client: WsClient;
  opened: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  /** Every JSON message received so far (oldest first). */
  messages: ChangeNotification[];
}

function connectSyncWs(url: string): SyncSocket {
  const client = new WsClient(url);
  const socket: SyncSocket = {
    client,
    opened: new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('unexpected-response', (_req, res) =>
        reject(new Error(`handshake rejected with HTTP ${res.statusCode}`)),
      );
    }),
    closed: new Promise((resolve) => {
      client.once('close', (code, reason) => resolve({ code, reason: reason?.toString() ?? '' }));
    }),
    messages: [],
  };
  client.on('message', (data) => {
    try {
      socket.messages.push(JSON.parse(data.toString()) as ChangeNotification);
    } catch {
      // non-JSON frames are not part of the contract — ignore
    }
  });
  // Never let a socket error crash the test process.
  client.on('error', () => {});
  return socket;
}

async function waitForChange(socket: SyncSocket, timeoutMs = 3000): Promise<ChangeNotification> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const next = socket.messages.shift();
    if (next) return next;
    await sleep(20);
  }
  throw new Error('no ws notification arrived within the deadline');
}

async function expectRejected(
  url: string,
  timeoutMs = 3000,
): Promise<{ code: number; reason: string }> {
  // The server completes the upgrade, then closes with 1008 before any
  // room membership — the universal rejection for browsers and ws clients.
  const socket = connectSyncWs(url);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('connection was not rejected within the deadline'));
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([socket.closed, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    socket.client.terminate(); // no-op when the rejection already closed it
  }
}

/** Mints a ticket over REST (bearer-authenticated) and opens the socket. */
async function connectAuthorized(baseUrl: string, bearer: string): Promise<SyncSocket> {
  const ticketRes = await call<TicketView>(baseUrl, 'POST', '/sync/ticket', { bearer });
  expect(ticketRes.status).toBe(201);
  expect(ticketRes.body.ticket).toBeTruthy();
  const socket = connectSyncWs(syncWsUrl(baseUrl, ticketRes.body.ticket));
  await socket.opened;
  return socket;
}

describe('Sync integration (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  describe('boot A — convergence, offline catch-up, tickets, retention', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let alice: AuthSession;
    let aliceDeviceA: AuthSession; // same user, second token (device A)
    let aliceDeviceB: AuthSession; // same user, third token (device B)
    let bob: AuthSession;

    let bm1: string; // created while device B watches (AC1)
    let bm2: string; // lives through tags/membership/trash/restore (AC2)
    let coll: string; // membership target (AC2)
    let collHard: string; // two-phase deleted (tombstone, AC2)
    let tagWorkId: string;
    let tagLaterId: string;

    beforeAll(async () => {
      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);

      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      alice = await createUserViaAdmin(baseUrl, admin, 'alice@arcdrop.test');
      aliceDeviceA = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: 'alice@arcdrop.test', password: 'user-password-1' },
      }).then((r) => {
        expect(r.status).toBe(201);
        return r.body;
      });
      aliceDeviceB = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: 'alice@arcdrop.test', password: 'user-password-1' },
      }).then((r) => {
        expect(r.status).toBe(201);
        return r.body;
      });
      bob = await createUserViaAdmin(baseUrl, admin, 'bob-sync@arcdrop.test');
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('exposes the sync contract in the served OpenAPI document (D9)', async () => {
      const res = await fetch(`${baseUrl}/openapi.json`);
      expect(res.status).toBe(200);
      const served = (await res.json()) as {
        paths: Record<string, Record<string, { operationId?: string }>>;
      };
      expect(served.paths['/api/v1/sync/state']?.get?.operationId).toBe('getSyncState');
      expect(served.paths['/api/v1/sync/changes']?.get?.operationId).toBe('listSyncChanges');
      expect(served.paths['/api/v1/sync/ticket']?.post?.operationId).toBe('createSyncTicket');
    });

    it('a fresh user starts at seq 0 with an empty, resync-free delta', async () => {
      const state = await call<StateView>(baseUrl, 'GET', '/sync/state', {
        bearer: alice.accessToken,
      });
      expect(state.status).toBe(200);
      expect(state.body.seq).toBe('0');

      const changes = await call<ChangesView>(baseUrl, 'GET', '/sync/changes', {
        bearer: alice.accessToken,
      });
      expect(changes.status).toBe(200);
      expect(changes.body).toEqual({ resyncRequired: false, changes: [], cursor: '0' });

      // seq values are decimal STRINGS (pg bigint) — never JS numbers.
      expect(typeof state.body.seq).toBe('string');
      expect(typeof changes.body.cursor).toBe('string');
    });

    it('POST /sync/ticket requires a bearer token', async () => {
      const res = await call(baseUrl, 'POST', '/sync/ticket');
      expect(res.status).toBe(401);
      expect(problem(res).code).toBe('UNAUTHORIZED');
    });

    it('AC1: device A mutates, device B is pushed and converges from its cursor', async () => {
      // Device B connects TWO sockets (a phone and a desktop) — both live in
      // alice's room and both must be notified.
      const deviceB = await connectAuthorized(baseUrl, aliceDeviceB.accessToken);
      const deviceB2 = await connectAuthorized(baseUrl, aliceDeviceB.accessToken);

      // Device A (another token, same user) creates a bookmark.
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: aliceDeviceA.accessToken,
        body: {
          url: 'https://docs.example.com/guide?page=2#setup',
          title: 'The Guide',
          excerpt: 'Sync backbone source material',
        },
      });
      expect(created.status).toBe(201);
      bm1 = created.body.id;

      // Both of B's connections receive the notification — seq 1, no payload.
      const note1 = await waitForChange(deviceB);
      expect(note1).toEqual({ seq: '1', entity: 'bookmark', id: bm1, action: 'create' });
      const note2 = await waitForChange(deviceB2);
      expect(note2).toEqual({ seq: '1', entity: 'bookmark', id: bm1, action: 'create' });

      // B pulls the delta from its (empty) cursor and gets the SNAPSHOT.
      const delta = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=0', {
        bearer: aliceDeviceB.accessToken,
      });
      expect(delta.status).toBe(200);
      expect(delta.body.resyncRequired).toBeFalse();
      expect(delta.body.changes).toHaveLength(1);
      const change = delta.body.changes[0]!;
      expect(change.seq).toBe('1');
      expect(change.entity).toBe('bookmark');
      expect(change.id).toBe(bm1);
      expect(change.action).toBe('create');
      const snapshot = change.snapshot as BookmarkView;
      expect(snapshot.url).toBe('https://docs.example.com/guide?page=2#setup');
      expect(snapshot.title).toBe('The Guide');
      expect(snapshot.deletedAt).toBeNull();
      expect(snapshot.urlParts.domain).toBe('example.com');
      expect(snapshot.tags).toEqual([]);

      // The cursor is exactly the seq B was notified about.
      expect(delta.body.cursor).toBe('1');
      const state = await call<StateView>(baseUrl, 'GET', '/sync/state', {
        bearer: aliceDeviceB.accessToken,
      });
      expect(state.body.seq).toBe('1');

      deviceB.client.close(1000, 'done');
      deviceB2.client.close(1000, 'done');
      await Promise.all([deviceB.closed, deviceB2.closed]);
    });

    it('AC2: offline reconstruction — since=0 replays multi-event mutations in seq order', async () => {
      // Device A performs a series of mutations WITHOUT any ws listener —
      // the "phone was offline" scenario. Later, a device pulls from 0.
      const putTags = await call<BookmarkView>(baseUrl, 'PUT', `/bookmarks/${bm1}/tags`, {
        bearer: aliceDeviceA.accessToken,
        body: { tags: ['work', 'later'] },
      });
      expect(putTags.status).toBe(200);
      tagWorkId = putTags.body.tags.find((t) => t.name === 'work')!.id;
      tagLaterId = putTags.body.tags.find((t) => t.name === 'later')!.id;
      // seq 2,3: tag:create ×2 — seq 4: bookmark:update
      const collCreated = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
        bearer: aliceDeviceA.accessToken,
        body: { title: 'Reading' },
      });
      expect(collCreated.status).toBe(201);
      coll = collCreated.body.id; // seq 5: collection:create

      const membership = await call(baseUrl, 'PUT', `/bookmarks/${bm1}/collections`, {
        bearer: aliceDeviceA.accessToken,
        body: { collectionIds: [coll] },
      });
      expect(membership.status).toBe(200); // seq 6,7: bookmark:update + collection:update

      // Rename tag 'work' → 'Work' (display case, no merge). seq 8.
      const rename = await call<TagView>(baseUrl, 'PUT', '/tags/work', {
        bearer: aliceDeviceA.accessToken,
        body: { name: 'Work' },
      });
      expect(rename.status).toBe(200);

      const trashed = await call(baseUrl, 'DELETE', `/bookmarks/${bm1}`, {
        bearer: aliceDeviceA.accessToken,
      });
      expect(trashed.status).toBe(204); // seq 9: bookmark:update (trash)
      const restored = await call<BookmarkView>(baseUrl, 'POST', `/bookmarks/${bm1}/restore`, {
        bearer: aliceDeviceA.accessToken,
      });
      expect(restored.status).toBe(200); // seq 10: bookmark:update (restore)

      const collHardCreated = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
        bearer: aliceDeviceA.accessToken,
        body: { title: 'Doomed' },
      });
      expect(collHardCreated.status).toBe(201);
      collHard = collHardCreated.body.id; // seq 11: collection:create
      const soft = await call(baseUrl, 'DELETE', `/collections/${collHard}`, {
        bearer: aliceDeviceA.accessToken,
      });
      expect(soft.status).toBe(204); // seq 12: collection:update (trash)
      const hard = await call(baseUrl, 'DELETE', `/collections/${collHard}`, {
        bearer: aliceDeviceA.accessToken,
      });
      expect(hard.status).toBe(204); // seq 13: collection:delete (tombstone)

      // The offline device pulls everything since seq 1 — 12 events.
      const delta = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=1', {
        bearer: aliceDeviceB.accessToken,
      });
      expect(delta.status).toBe(200);
      expect(delta.body.resyncRequired).toBeFalse();
      const seqs = delta.body.changes.map((c) => BigInt(c.seq));
      expect(seqs.map(String)).toEqual([
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        '10',
        '11',
        '12',
        '13',
      ]);
      expect(delta.body.cursor).toBe('13');

      const bySeq = new Map(delta.body.changes.map((c) => [c.seq, c]));

      // Tag creations carry tag snapshots. Snapshots are the entity's
      // CURRENT row at PULL time (rows carry no payload) — so the seq-2
      // tag:create already reflects the seq-8 rename's display name. A
      // client replaying in seq order still converges: the rename event
      // comes later and its own snapshot agrees.
      const tagCreate = bySeq.get('2')!;
      expect(tagCreate.entity).toBe('tag');
      expect(tagCreate.action).toBe('create');
      expect(tagCreate.id).toBe(tagWorkId);
      expect((tagCreate.snapshot as TagSnapshotView).name).toBe('Work');
      expect(bySeq.get('3')!.entity).toBe('tag');
      expect(bySeq.get('3')!.id).toBe(tagLaterId);
      expect((bySeq.get('3')!.snapshot as TagSnapshotView).name).toBe('later');

      // The bookmark:update events carry the CURRENT row: tags under their
      // renamed display name, deletedAt null (restored).
      const bmUpdate = bySeq.get('4')!;
      expect(bmUpdate.entity).toBe('bookmark');
      expect(bmUpdate.action).toBe('update');
      const bmSnapshot = bmUpdate.snapshot as BookmarkView;
      expect(bmSnapshot.id).toBe(bm1);
      expect(bmSnapshot.tags.map((t) => t.name).sort()).toEqual(['Work', 'later']);
      expect(bmSnapshot.deletedAt).toBeNull();
      expect(bySeq.get('9')!.action).toBe('update'); // trash
      expect(bySeq.get('10')!.action).toBe('update'); // restore
      expect((bySeq.get('10')!.snapshot as BookmarkView).deletedAt).toBeNull();

      // Membership change: the bookmark:update snapshot knows the collection…
      const bmMembership = bySeq.get('6')!;
      expect(bmMembership.action).toBe('update');
      // …and the collection:update carries the collection snapshot.
      const collUpdate = bySeq.get('7')!;
      expect(collUpdate.entity).toBe('collection');
      expect(collUpdate.action).toBe('update');
      expect((collUpdate.snapshot as CollectionSnapshotView).title).toBe('Reading');

      // Rename: the tag:update event carries the renamed tag.
      const renameChange = bySeq.get('8')!;
      expect(renameChange.entity).toBe('tag');
      expect(renameChange.action).toBe('update');
      expect((renameChange.snapshot as TagSnapshotView).name).toBe('Work');
      expect(renameChange.id).toBe(tagWorkId);

      // Two-phase delete: trash is an update, HARD delete is the tombstone.
      expect(bySeq.get('12')!.entity).toBe('collection');
      expect(bySeq.get('12')!.action).toBe('update');
      const tombstone = bySeq.get('13')!;
      expect(tombstone.entity).toBe('collection');
      expect(tombstone.action).toBe('delete');
      expect(tombstone.id).toBe(collHard);
      expect(tombstone.snapshot).toBeNull();

      // Deterministic paging: same events, same order, no dupes or gaps.
      const page: ChangeView[] = [];
      let cursor = '1';
      for (let i = 0; i < 10; i++) {
        const res = await call<ChangesView>(
          baseUrl,
          'GET',
          `/sync/changes?since=${cursor}&limit=3`,
          { bearer: aliceDeviceB.accessToken },
        );
        expect(res.status).toBe(200);
        expect(res.body.resyncRequired).toBeFalse();
        page.push(...res.body.changes);
        cursor = res.body.cursor;
        if (res.body.changes.length < 3) break;
      }
      expect(page.map((c) => c.seq)).toEqual(delta.body.changes.map((c) => c.seq));
      expect(cursor).toBe('13');

      // The counter agrees with the last delivered event.
      const state = await call<StateView>(baseUrl, 'GET', '/sync/state', {
        bearer: alice.accessToken,
      });
      expect(state.body.seq).toBe('13');
    });

    it('rejects garbage cursors with problem+json validation errors', async () => {
      const garbage = ['abc', '-5', '0x10', '007', '92233720368547758070'];
      for (const since of garbage) {
        const res = await call(baseUrl, 'GET', `/sync/changes?since=${since}`, {
          bearer: alice.accessToken,
        });
        expect(res.status).toBe(400);
        expect(problem(res).code).toBe('VALIDATION_FAILED');
      }
      const badLimit = await call(baseUrl, 'GET', '/sync/changes?limit=0', {
        bearer: alice.accessToken,
      });
      expect(badLimit.status).toBe(400);

      // A huge-but-valid limit never 400s (clamped, like bookmark paging).
      const bigLimit = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?limit=5000', {
        bearer: alice.accessToken,
      });
      expect(bigLimit.status).toBe(200);
      expect(bigLimit.body.resyncRequired).toBeFalse();

      // A cursor the counter never issued (regex-valid but beyond both the
      // counter and the pg bigint ceiling) short-circuits to resync.
      const future = await call<ChangesView>(
        baseUrl,
        'GET',
        '/sync/changes?since=9999999999999999999',
        { bearer: alice.accessToken },
      );
      expect(future.status).toBe(200);
      expect(future.body.resyncRequired).toBeTrue();
      expect(future.body.changes).toEqual([]);
    });

    it('AC5: a second user never receives another user’s events', async () => {
      const bobSocket = await connectAuthorized(baseUrl, bob.accessToken);

      // Alice mutates while bob listens.
      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: aliceDeviceA.accessToken,
        body: { url: 'https://alice-private.example.com/x' },
      });
      expect(created.status).toBe(201);
      bm2 = created.body.id; // alice seq 14

      await sleep(600);
      expect(bobSocket.messages).toHaveLength(0);

      // Sanity: alice's own delta carried the change (per-user counters).
      const aliceDelta = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=13', {
        bearer: alice.accessToken,
      });
      expect(aliceDelta.body.changes.map((c) => c.id)).toEqual([bm2]);
      expect(aliceDelta.body.changes[0]!.seq).toBe('14');

      // Bob's own mutation IS pushed to bob — the pipe works.
      const bobBookmark = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: bob.accessToken,
        body: { url: 'https://bob-owns.example.com/y' },
      });
      expect(bobBookmark.status).toBe(201);
      const bobNote = await waitForChange(bobSocket);
      expect(bobNote).toEqual({
        seq: '1',
        entity: 'bookmark',
        id: bobBookmark.body.id,
        action: 'create',
      });

      // Bob's log only ever shows bob's data (per-user counters).
      const bobDelta = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=0', {
        bearer: bob.accessToken,
      });
      expect(bobDelta.body.changes.map((c) => c.seq)).toEqual(['1']);
      expect(bobDelta.body.changes[0]!.id).toBe(bobBookmark.body.id);

      bobSocket.client.close(1000, 'done');
      await bobSocket.closed;
    });

    it('AC4: the ws handshake is refused without a valid one-time ticket', async () => {
      const rejectMissing = await expectRejected(syncWsUrl(baseUrl));
      expect(rejectMissing.code).toBe(1008);

      const rejectUnknown = await expectRejected(syncWsUrl(baseUrl, 'definitely-not-a-ticket'));
      expect(rejectUnknown.code).toBe(1008);

      // A ticket redeems exactly once — the replayed handshake is refused.
      const minted = await call<TicketView>(baseUrl, 'POST', '/sync/ticket', {
        bearer: alice.accessToken,
      });
      expect(minted.status).toBe(201);
      const first = connectSyncWs(syncWsUrl(baseUrl, minted.body.ticket));
      await first.opened;
      first.client.close(1000, 'bye');
      await first.closed;

      const rejectReplay = await expectRejected(syncWsUrl(baseUrl, minted.body.ticket));
      expect(rejectReplay.code).toBe(1008);

      // An expired (force-expired) ticket is refused too.
      const tickets = app.get(SyncTicketService);
      const shortLived = await call<TicketView>(baseUrl, 'POST', '/sync/ticket', {
        bearer: alice.accessToken,
      });
      tickets.expire(shortLived.body.ticket);
      const rejectExpired = await expectRejected(syncWsUrl(baseUrl, shortLived.body.ticket));
      expect(rejectExpired.code).toBe(1008);
    });

    it('AC3+AC6: retention compaction — deep offline resyncs, live cursors keep working', async () => {
      // Alice now holds seqs 1..14. Simulate an old log: backdate seqs ≤ 10
      // beyond ANY retention horizon, then shrink the window to its minimum.
      await dataSource.query(
        `UPDATE change_events SET created_at = NOW() - INTERVAL '400 days'
          WHERE user_id = $1 AND seq::bigint <= 10`,
        [alice.user.id],
      );
      const settingsRes = await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { changeLogRetentionDays: 1 },
      });
      expect(settingsRes.status).toBe(200);

      const purge = app.get(ChangeLogRetentionService);
      const summary = await purge.purgeExpired();
      expect(summary.purged).toBe(10); // seqs 1..10 are gone; 11..14 survive

      // Deep-offline device (cursor 0): the delta would silently miss data.
      const deep = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=0', {
        bearer: alice.accessToken,
      });
      expect(deep.status).toBe(200);
      expect(deep.body.resyncRequired).toBeTrue();
      expect(deep.body.changes).toEqual([]);
      expect(deep.body.cursor).toBe('14'); // adopt this after refetching lists

      // The exact retention boundary is still served: cursor 10 needs seq 11,
      // which IS retained — no resync.
      const boundary = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=10', {
        bearer: alice.accessToken,
      });
      expect(boundary.body.resyncRequired).toBeFalse();
      expect(boundary.body.changes.map((c) => c.seq)).toEqual(['11', '12', '13', '14']);

      // A live cursor keeps working unchanged (retention never breaks it).
      const live = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=14', {
        bearer: alice.accessToken,
      });
      expect(live.body.resyncRequired).toBeFalse();
      expect(live.body.changes).toEqual([]);
      expect(live.body.cursor).toBe('14');

      // New activity flows to the live cursor as usual.
      const fresh = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: aliceDeviceA.accessToken,
        body: { url: 'https://post-compaction.example.com/z' },
      });
      expect(fresh.status).toBe(201); // alice seq 15
      const after = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=14', {
        bearer: alice.accessToken,
      });
      expect(after.body.resyncRequired).toBeFalse();
      expect(after.body.changes.map((c) => c.seq)).toEqual(['15']);
      expect((after.body.changes[0]!.snapshot as BookmarkView).url).toBe(
        'https://post-compaction.example.com/z',
      );
      expect(after.body.cursor).toBe('15');

      // Restore the knob for tidiness (wipeData clears settings anyway).
      await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { changeLogRetentionDays: 90 },
      });
    });

    it('AC3 (ws flavor): a device that reconnects late is pushed only what it missed', async () => {
      // Connected device misses nothing; a device that connects NOW only
      // ever sees POST-connection changes (the REST delta covers the past).
      const lateDevice = await connectAuthorized(baseUrl, aliceDeviceB.accessToken);

      const created = await call<BookmarkView>(baseUrl, 'POST', '/bookmarks', {
        bearer: aliceDeviceA.accessToken,
        body: { url: 'https://late-arrival.example.com/w' },
      });
      expect(created.status).toBe(201); // alice seq 16

      const note = await waitForChange(lateDevice);
      expect(note).toEqual({
        seq: '16',
        entity: 'bookmark',
        id: created.body.id,
        action: 'create',
      });
      // The notification is INCLUSIVE of seq 16: the device's last cursor is
      // 15, so it pulls since=15 and receives exactly the notified event.
      const delta = await call<ChangesView>(baseUrl, 'GET', '/sync/changes?since=15', {
        bearer: aliceDeviceB.accessToken,
      });
      expect(delta.body.changes).toHaveLength(1);
      expect(delta.body.changes[0]!.seq).toBe('16');
      expect(delta.body.changes[0]!.id).toBe(created.body.id);
      expect(delta.body.cursor).toBe(note.seq);

      lateDevice.client.close(1000, 'done');
      await lateDevice.closed;
    });
  });
});
