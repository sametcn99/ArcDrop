import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { createSyncEngine } from './sync-engine';
import { buildLibraryViewKey, useLibraryStore } from '../stores/libraryStore';
import { useSyncStore } from '../stores/syncStore';
import {
  makeMockBookmark,
  makeMockCollection,
  makeMockStats,
  makeMockTagUsage,
} from '../test/msw/handlers';
import { server } from '../test/msw/server';
import { FakeWebSocket } from '../test/ws/fake-ws';

async function flushAsync() {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

function requireSocket(sockets: FakeWebSocket[], index: number): FakeWebSocket {
  const socket = sockets[index];
  if (!socket) {
    throw new Error(`Expected socket at index ${index}, got ${sockets.length}`);
  }
  return socket;
}

function createHarness(options?: {
  autoOpen?: boolean;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  pollIntervalMs?: number;
}) {
  const client = createApiClient({ baseUrl: 'https://api.arcdrop.test' });
  client.setTokens({ accessToken: 'access-test', refreshToken: 'refresh-test' });

  const sockets: FakeWebSocket[] = [];
  let autoOpen = options?.autoOpen ?? false;

  class HarnessWebSocket extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      sockets.push(this);
      if (autoOpen) {
        queueMicrotask(() => this.simulateOpen());
      }
    }
  }

  const engine = createSyncEngine({
    client,
    WebSocketCtor: HarnessWebSocket,
    backoffBaseMs: options?.backoffBaseMs ?? 1000,
    backoffMaxMs: options?.backoffMaxMs ?? 8000,
    pollIntervalMs: options?.pollIntervalMs ?? 5000,
  });

  return {
    client,
    engine,
    sockets,
    setAutoOpen(next: boolean) {
      autoOpen = next;
    },
  };
}

describe('sync-engine', () => {
  it('bootstraps stores and cursor, mints a ticket, and enters live state when WS opens', async () => {
    const bm1 = makeMockBookmark({ id: 'bm-1', title: 'Initial Bookmark' });
    const col1 = makeMockCollection({ id: 'col-1', title: 'Docs', bookmarkCount: 1 });
    const tag1 = makeMockTagUsage({ id: 'tag-1', name: 'docs', count: 1 });

    server.use(
      http.get('https://api.arcdrop.test/api/v1/sync/state', () =>
        HttpResponse.json({ seq: '42' }),
      ),
      http.get('https://api.arcdrop.test/api/v1/bookmarks', () =>
        HttpResponse.json({ items: [bm1], totalCount: 1, page: 1, pageSize: 24 }),
      ),
      http.get('https://api.arcdrop.test/api/v1/collections', () =>
        HttpResponse.json({ items: [col1] }),
      ),
      http.get('https://api.arcdrop.test/api/v1/bookmarks/tags', () => HttpResponse.json([tag1])),
      http.get('https://api.arcdrop.test/api/v1/bookmarks/stats', () =>
        HttpResponse.json(makeMockStats({ total: 1, unassigned: 0, favorites: 0 })),
      ),
      http.post('https://api.arcdrop.test/api/v1/sync/ticket', () =>
        HttpResponse.json(
          { ticket: 'ticket-abc', expiresAt: '2026-11-14T16:00:00.000Z' },
          { status: 201 },
        ),
      ),
      http.get('https://api.arcdrop.test/api/v1/sync/changes', () =>
        HttpResponse.json({ resyncRequired: false, changes: [], cursor: '42' }),
      ),
    );

    const { engine, sockets } = createHarness();
    await engine.start();

    expect(useSyncStore.getState().cursor).toBe('42');
    expect(useLibraryStore.getState().bookmarksById['bm-1']?.title).toBe('Initial Bookmark');
    expect(useLibraryStore.getState().collectionsById['col-1']?.title).toBe('Docs');
    expect(useLibraryStore.getState().tagsById['tag-1']?.name).toBe('docs');
    expect(sockets).toHaveLength(1);

    const ws0 = requireSocket(sockets, 0);
    expect(ws0.url).toBe('wss://api.arcdrop.test/api/v1/sync/ws?ticket=ticket-abc');

    ws0.simulateOpen();
    await flushAsync();

    expect(useSyncStore.getState().connectionState).toBe('live');
    engine.stop();
  });

  it('applies create, update, and tombstone deltas in ascending seq order even when delivered out of order', async () => {
    const bm1 = makeMockBookmark({ id: 'bm-1', title: 'Original Title', favorite: false });
    const bm2 = makeMockBookmark({ id: 'bm-2', title: 'Second Bookmark' });
    const createdBm3 = makeMockBookmark({ id: 'bm-3', title: 'Draft Title' });
    const updatedBm3 = makeMockBookmark({
      id: 'bm-3',
      title: 'Final Authoritative Title',
      favorite: true,
    });

    const requestedSince: string[] = [];

    server.use(
      http.get('https://api.arcdrop.test/api/v1/sync/state', () =>
        HttpResponse.json({ seq: '10' }),
      ),
      http.get('https://api.arcdrop.test/api/v1/bookmarks', () =>
        HttpResponse.json({ items: [bm1, bm2], totalCount: 2, page: 1, pageSize: 24 }),
      ),
      http.get('https://api.arcdrop.test/api/v1/collections', () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get('https://api.arcdrop.test/api/v1/bookmarks/tags', () => HttpResponse.json([])),
      http.get('https://api.arcdrop.test/api/v1/bookmarks/stats', () =>
        HttpResponse.json(makeMockStats({ total: 2, favorites: 0 })),
      ),
      http.post('https://api.arcdrop.test/api/v1/sync/ticket', () =>
        HttpResponse.json(
          { ticket: 'ticket-1', expiresAt: '2026-11-14T16:00:00.000Z' },
          { status: 201 },
        ),
      ),
      http.get('https://api.arcdrop.test/api/v1/sync/changes', ({ request }) => {
        const since = new URL(request.url).searchParams.get('since') ?? '';
        requestedSince.push(since);
        if (requestedSince.length === 1) {
          return HttpResponse.json({ resyncRequired: false, changes: [], cursor: '10' });
        }
        // Intentionally deliver out of seq order: 13 (delete bm-2), 12 (update bm-3), 11 (create bm-3)
        return HttpResponse.json({
          resyncRequired: false,
          cursor: '13',
          changes: [
            {
              seq: '13',
              entity: 'bookmark',
              id: 'bm-2',
              action: 'delete',
              snapshot: null,
            },
            {
              seq: '12',
              entity: 'bookmark',
              id: 'bm-3',
              action: 'update',
              snapshot: updatedBm3,
            },
            {
              seq: '11',
              entity: 'bookmark',
              id: 'bm-3',
              action: 'create',
              snapshot: createdBm3,
            },
          ],
        });
      }),
    );

    const { engine, sockets } = createHarness();
    await engine.start();
    const ws0 = requireSocket(sockets, 0);
    ws0.simulateOpen();
    await flushAsync();

    // Notify arrival via WS frame
    ws0.simulateMessage({
      seq: '13',
      entity: 'bookmark',
      id: 'bm-2',
      action: 'delete',
    });

    await vi.waitFor(() => {
      expect(useSyncStore.getState().cursor).toBe('13');
    });

    const lib = useLibraryStore.getState();
    expect(lib.bookmarksById['bm-2']).toBeUndefined();
    expect(lib.bookmarksById['bm-3']?.title).toBe('Final Authoritative Title');
    expect(lib.bookmarksById['bm-3']?.favorite).toBe(true);
    const allView = lib.views[buildLibraryViewKey('all', 'updated')];
    expect(allView?.ids).not.toContain('bm-2');
    expect(allView?.ids).toContain('bm-3');
    expect(requestedSince).toEqual(['10', '10']);
    engine.stop();
  });

  it('triggers a full refetch and adopts cursor when /sync/changes returns resyncRequired=true', async () => {
    const initialBm = makeMockBookmark({ id: 'bm-stale', title: 'Stale Bookmark' });
    const freshBm = makeMockBookmark({ id: 'bm-fresh', title: 'Fresh After Resync' });
    let listCalls = 0;

    server.use(
      http.get('https://api.arcdrop.test/api/v1/sync/state', () => HttpResponse.json({ seq: '5' })),
      http.get('https://api.arcdrop.test/api/v1/bookmarks', () => {
        listCalls += 1;
        const items = listCalls === 1 ? [initialBm] : [freshBm];
        return HttpResponse.json({ items, totalCount: 1, page: 1, pageSize: 24 });
      }),
      http.get('https://api.arcdrop.test/api/v1/collections', () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get('https://api.arcdrop.test/api/v1/bookmarks/tags', () => HttpResponse.json([])),
      http.get('https://api.arcdrop.test/api/v1/bookmarks/stats', () =>
        HttpResponse.json(makeMockStats({ total: 1 })),
      ),
      http.post('https://api.arcdrop.test/api/v1/sync/ticket', () =>
        HttpResponse.json(
          { ticket: 'ticket-resync', expiresAt: '2026-11-14T16:00:00.000Z' },
          { status: 201 },
        ),
      ),
      http.get('https://api.arcdrop.test/api/v1/sync/changes', () =>
        HttpResponse.json({
          resyncRequired: true,
          changes: [],
          cursor: '150',
        }),
      ),
    );

    const { engine, sockets } = createHarness();
    await engine.start();
    requireSocket(sockets, 0).simulateOpen();

    await vi.waitFor(() => {
      expect(useSyncStore.getState().cursor).toBe('150');
    });

    expect(listCalls).toBe(2);
    const activeIds =
      useLibraryStore.getState().views[buildLibraryViewKey('all', 'updated')]?.ids ?? [];
    expect(activeIds).toEqual(['bm-fresh']);
    engine.stop();
  });

  it('transitions live -> polling -> offline -> polling -> live with fresh ticket reconnect and cursor resume', async () => {
    vi.useFakeTimers();

    let remoteSeq = '20';
    let stateShouldFail = false;
    let ticketCounter = 0;
    const syncedSinceArgs: string[] = [];

    const missedBookmark = makeMockBookmark({
      id: 'bm-missed',
      title: 'Added While WS Down',
    });
    const recoveredBookmark = makeMockBookmark({
      id: 'bm-recovered',
      title: 'Added On Reconnect',
    });

    server.use(
      http.get('https://api.arcdrop.test/api/v1/sync/state', () => {
        if (stateShouldFail) {
          return HttpResponse.error();
        }
        return HttpResponse.json({ seq: remoteSeq });
      }),
      http.get('https://api.arcdrop.test/api/v1/bookmarks', () =>
        HttpResponse.json({
          items: [makeMockBookmark({ id: 'bm-1' })],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        }),
      ),
      http.get('https://api.arcdrop.test/api/v1/collections', () =>
        HttpResponse.json({ items: [] }),
      ),
      http.get('https://api.arcdrop.test/api/v1/bookmarks/tags', () => HttpResponse.json([])),
      http.get('https://api.arcdrop.test/api/v1/bookmarks/stats', () =>
        HttpResponse.json(makeMockStats({ total: 1 })),
      ),
      http.post('https://api.arcdrop.test/api/v1/sync/ticket', () => {
        ticketCounter += 1;
        return HttpResponse.json(
          { ticket: `ticket-${ticketCounter}`, expiresAt: '2026-11-14T16:00:00.000Z' },
          { status: 201 },
        );
      }),
      http.get('https://api.arcdrop.test/api/v1/sync/changes', ({ request }) => {
        const since = new URL(request.url).searchParams.get('since') ?? '';
        syncedSinceArgs.push(since);
        if (since === '20' && remoteSeq === '21') {
          return HttpResponse.json({
            resyncRequired: false,
            cursor: '21',
            changes: [
              {
                seq: '21',
                entity: 'bookmark',
                id: 'bm-missed',
                action: 'create',
                snapshot: missedBookmark,
              },
            ],
          });
        }
        if (since === '21' && remoteSeq === '22') {
          return HttpResponse.json({
            resyncRequired: false,
            cursor: '22',
            changes: [
              {
                seq: '22',
                entity: 'bookmark',
                id: 'bm-recovered',
                action: 'create',
                snapshot: recoveredBookmark,
              },
            ],
          });
        }
        return HttpResponse.json({
          resyncRequired: false,
          changes: [],
          cursor: remoteSeq,
        });
      }),
    );

    const { engine, sockets } = createHarness({
      backoffBaseMs: 1000,
      backoffMaxMs: 4000,
      pollIntervalMs: 3000,
    });

    await engine.start();
    expect(sockets).toHaveLength(1);
    const ws0 = requireSocket(sockets, 0);
    expect(ws0.ticket).toBe('ticket-1');
    ws0.simulateOpen();
    await flushAsync();
    expect(useSyncStore.getState().connectionState).toBe('live');

    // Drop WS -> immediate fallback to polling
    ws0.simulateClose(1006, 'Connection dropped');
    expect(useSyncStore.getState().connectionState).toBe('polling');

    // Backoff reconnect attempt #1 at 1000ms mints fresh ticket-2, fails immediately
    await vi.advanceTimersByTimeAsync(1000);
    await flushAsync();
    expect(sockets).toHaveLength(2);
    const ws1 = requireSocket(sockets, 1);
    expect(ws1.ticket).toBe('ticket-2');
    ws1.simulateClose(1006);
    expect(useSyncStore.getState().reconnectAttempt).toBe(2);

    // At 3000ms total since drop, fallback poll ticks and notices seq 21 > 20
    remoteSeq = '21';
    await vi.advanceTimersByTimeAsync(2000);
    await flushAsync();
    expect(useSyncStore.getState().cursor).toBe('21');
    expect(useLibraryStore.getState().bookmarksById['bm-missed']?.title).toBe(
      'Added While WS Down',
    );

    // Exponential backoff delay is 2000ms from 1000ms -> fires at 3000ms
    expect(sockets).toHaveLength(3);
    const ws2 = requireSocket(sockets, 2);
    expect(ws2.ticket).toBe('ticket-3');
    ws2.simulateClose(1006);

    // Next poll fails -> offline state
    stateShouldFail = true;
    await vi.advanceTimersByTimeAsync(3000);
    await flushAsync();
    expect(useSyncStore.getState().connectionState).toBe('offline');

    // Network returns for polling -> recovers to polling
    stateShouldFail = false;
    await vi.advanceTimersByTimeAsync(3000);
    await flushAsync();
    expect(useSyncStore.getState().connectionState).toBe('polling');

    expect(sockets.length).toBeGreaterThanOrEqual(4);
    const latestSocket = requireSocket(sockets, sockets.length - 1);
    remoteSeq = '22';
    vi.useRealTimers();
    latestSocket.simulateOpen();

    await vi.waitFor(() => {
      expect(useSyncStore.getState().cursor).toBe('22');
    });

    expect(useSyncStore.getState().connectionState).toBe('live');
    expect(useLibraryStore.getState().bookmarksById['bm-recovered']?.title).toBe(
      'Added On Reconnect',
    );
    expect(syncedSinceArgs).toContain('21');
    engine.stop();
  });
});
