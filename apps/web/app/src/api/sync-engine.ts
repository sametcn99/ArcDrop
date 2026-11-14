import { apiClient, type ApiClient } from './client';
import { createBookmarksApi } from './endpoints/bookmarks';
import { createCollectionsApi } from './endpoints/collections';
import { createSyncApi } from './endpoints/sync';
import type { BookmarkListQuery } from './schemas/bookmarks';
import { toApiError } from './schemas/problem';
import { syncWsFrameSchema } from './schemas/sync';
import {
  buildLibraryViewKey,
  DEFAULT_LIBRARY_PAGE_SIZE,
  useLibraryStore,
  type LibraryScope,
} from '../stores/libraryStore';
import { useSyncStore } from '../stores/syncStore';
import { useUiStore } from '../stores/uiStore';

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  close: (code?: number, reason?: string) => void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface SyncEngineDeps {
  client?: ApiClient;
  WebSocketCtor?: WebSocketConstructor;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  pollIntervalMs?: number;
  changesPageLimit?: number;
}

export interface SyncStartOptions {
  initialQuery?: BookmarkListQuery;
  viewKey?: string;
}

function buildWsUrl(baseUrl: string, ticket: string): string {
  let httpBase = baseUrl.trim().replace(/\/+$/, '');
  if (httpBase === '') {
    if (
      typeof window !== 'undefined' &&
      typeof window.location?.origin === 'string' &&
      /^https?:\/\//.test(window.location.origin)
    ) {
      httpBase = window.location.origin;
    } else {
      httpBase = 'http://localhost';
    }
  }

  const wsBase = httpBase.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
  return `${wsBase}/api/v1/sync/ws?ticket=${encodeURIComponent(ticket)}`;
}

function maxSeq(a: string, b: string): string {
  try {
    return BigInt(a) >= BigInt(b) ? a : b;
  } catch {
    return b;
  }
}

function isGreaterSeq(candidate: string, baseline: string): boolean {
  try {
    return BigInt(candidate) > BigInt(baseline);
  } catch {
    return candidate !== baseline;
  }
}

export function createSyncEngine(deps: SyncEngineDeps = {}) {
  const client = deps.client ?? apiClient;
  const bookmarks = createBookmarksApi(client);
  const collections = createCollectionsApi(client);
  const sync = createSyncApi(client);

  const backoffBaseMs = deps.backoffBaseMs ?? 1000;
  const backoffMaxMs = deps.backoffMaxMs ?? 30_000;
  const pollIntervalMs = deps.pollIntervalMs ?? 15_000;
  const changesPageLimit = deps.changesPageLimit ?? 200;

  let running = false;
  let sessionToken = 0;
  let currentWs: WebSocketLike | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pullInFlight: Promise<void> | null = null;
  let pendingPull = false;
  let startPromise: Promise<void> | null = null;

  function resolveWsConstructor(): WebSocketConstructor | undefined {
    if (deps.WebSocketCtor) return deps.WebSocketCtor;
    if (typeof globalThis !== 'undefined' && typeof globalThis.WebSocket === 'function') {
      return globalThis.WebSocket as unknown as WebSocketConstructor;
    }
    return undefined;
  }

  function clearReconnectTimer(): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function closeSocket(): void {
    if (currentWs) {
      const ws = currentWs;
      currentWs = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close(1000, 'Client sync stopped');
      } catch {
        // Ignore errors when closing an already closed socket.
      }
    }
  }

  function isActive(token: number): boolean {
    return running && token === sessionToken;
  }

  function resolveActiveListQuery(): { viewKey: string; query: BookmarkListQuery } {
    const activeKey = useLibraryStore.getState().activeViewKey;
    const [rawScope, rawSort] = activeKey.split('|');
    const scope: LibraryScope =
      rawScope === 'favorites' || rawScope === 'unassigned' ? rawScope : 'all';
    const sort =
      rawSort === 'created' || rawSort === 'title' || rawSort === 'manual' ? rawSort : 'updated';

    const query: BookmarkListQuery = {
      page: 1,
      pageSize: DEFAULT_LIBRARY_PAGE_SIZE,
      sort,
      trashed: false,
    };
    if (scope === 'favorites') {
      query.favorite = true;
    } else if (scope === 'unassigned') {
      query.unassignedOnly = true;
    }
    return { viewKey: buildLibraryViewKey(scope, sort), query };
  }

  async function performFullResync(token: number, adoptedCursor?: string): Promise<void> {
    const { viewKey, query } = resolveActiveListQuery();
    const libraryStore = useLibraryStore.getState();
    const syncStore = useSyncStore.getState();

    const [stateRes, listRes, colsRes, tagsRes, statsRes] = await Promise.all([
      adoptedCursor !== undefined ? Promise.resolve({ seq: adoptedCursor }) : sync.getState(),
      bookmarks.list(query),
      collections.list(),
      bookmarks.tags(),
      bookmarks.stats(),
    ]);

    if (!isActive(token)) return;

    libraryStore.hydrateView(viewKey, listRes, false);
    libraryStore.hydrateCollections(colsRes.items);
    libraryStore.hydrateTags(tagsRes);
    libraryStore.hydrateStats(statsRes);

    const nextCursor = maxSeq(syncStore.cursor, stateRes.seq);
    syncStore.markSynced(nextCursor);
  }

  async function runPollTick(token: number): Promise<void> {
    if (!isActive(token)) return;
    const syncStore = useSyncStore.getState();
    try {
      const remote = await sync.getState();
      if (!isActive(token)) return;

      if (useSyncStore.getState().connectionState === 'offline') {
        useSyncStore.getState().setConnectionState('polling');
      }
      useSyncStore.getState().setError(null);

      if (isGreaterSeq(remote.seq, useSyncStore.getState().cursor)) {
        await pullChangesInternal(token);
      }
    } catch (err) {
      if (!isActive(token)) return;
      const apiErr = toApiError(err);
      syncStore.setError(apiErr.detail);
      syncStore.setConnectionState('offline');
    }
  }

  function startPolling(token: number): void {
    if (!isActive(token)) return;
    const syncStore = useSyncStore.getState();
    if (syncStore.connectionState !== 'offline') {
      syncStore.setConnectionState('polling');
    }
    if (pollTimer !== null) return;
    pollTimer = setInterval(() => {
      void runPollTick(token);
    }, pollIntervalMs);
  }

  function scheduleReconnect(token: number): void {
    if (!isActive(token)) return;
    clearReconnectTimer();
    const syncStore = useSyncStore.getState();
    const attempt = syncStore.reconnectAttempt;
    const delay = Math.min(backoffMaxMs, backoffBaseMs * 2 ** attempt);
    syncStore.setReconnectAttempt(attempt + 1);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectWebSocket(token);
    }, delay);
  }

  async function pullChangesInternal(token: number): Promise<void> {
    if (!isActive(token)) return;
    if (pullInFlight) {
      pendingPull = true;
      return pullInFlight;
    }

    const run = (async () => {
      const syncStore = useSyncStore.getState();
      syncStore.setSyncing(true);
      try {
        do {
          pendingPull = false;
          while (isActive(token)) {
            const since = useSyncStore.getState().cursor;
            const res = await sync.getChanges(since, changesPageLimit);
            if (!isActive(token)) return;

            if (res.resyncRequired) {
              await performFullResync(token, res.cursor);
              break;
            }

            if (res.changes.length > 0) {
              useLibraryStore.getState().applySyncChanges(res.changes);
            }

            const nextCursor = maxSeq(useSyncStore.getState().cursor, res.cursor);
            useSyncStore.getState().markSynced(nextCursor);

            if (res.changes.length < changesPageLimit) {
              break;
            }
          }
        } while (pendingPull && isActive(token));
      } catch (err) {
        if (!isActive(token)) return;
        const apiErr = toApiError(err);
        useSyncStore.getState().setError(apiErr.detail);
        if (apiErr.status === 0) {
          useSyncStore.getState().setConnectionState('offline');
        }
      } finally {
        useSyncStore.getState().setSyncing(false);
        pullInFlight = null;
      }
    })();

    pullInFlight = run;
    return run;
  }

  async function connectWebSocket(token: number): Promise<void> {
    if (!isActive(token)) return;
    clearReconnectTimer();
    closeSocket();

    const WsCtor = resolveWsConstructor();
    if (!WsCtor) {
      startPolling(token);
      return;
    }

    let ticket: string;
    try {
      const ticketRes = await sync.createTicket();
      ticket = ticketRes.ticket;
    } catch (err) {
      if (!isActive(token)) return;
      const apiErr = toApiError(err);
      useSyncStore.getState().setError(apiErr.detail);
      if (apiErr.status === 0) {
        useSyncStore.getState().setConnectionState('offline');
      } else {
        useSyncStore.getState().setConnectionState('polling');
      }
      startPolling(token);
      scheduleReconnect(token);
      return;
    }

    if (!isActive(token)) return;

    const wsUrl = buildWsUrl(client.getBaseUrl(), ticket);
    let ws: WebSocketLike;
    try {
      ws = new WsCtor(wsUrl);
    } catch (err) {
      const apiErr = toApiError(err);
      useSyncStore.getState().setError(apiErr.detail);
      startPolling(token);
      scheduleReconnect(token);
      return;
    }

    currentWs = ws;
    let disconnectHandled = false;

    const handleDisconnect = () => {
      if (disconnectHandled || !isActive(token)) return;
      disconnectHandled = true;
      if (currentWs === ws) {
        currentWs = null;
      }
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      startPolling(token);
      scheduleReconnect(token);
    };

    ws.onopen = () => {
      if (!isActive(token) || currentWs !== ws) {
        ws.close(1000);
        return;
      }
      stopPolling();
      clearReconnectTimer();
      useSyncStore.getState().setReconnectAttempt(0);
      useSyncStore.getState().setConnectionState('live');
      useSyncStore.getState().setError(null);
      void pullChangesInternal(token);
    };

    ws.onmessage = (event) => {
      if (!isActive(token)) return;
      if (typeof event.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = syncWsFrameSchema.safeParse(raw);
      if (!parsed.success) return;

      const frame = parsed.data;
      if ('type' in frame && frame.type === 'reminder') {
        useUiStore.getState().enqueueSnackbar({
          message: frame.title ? `Reminder: ${frame.title}` : 'Bookmark reminder due',
          severity: 'info',
        });
        return;
      }

      if ('seq' in frame) {
        void pullChangesInternal(token);
      }
    };

    ws.onerror = () => {
      handleDisconnect();
    };

    ws.onclose = () => {
      handleDisconnect();
    };
  }

  async function bootstrapAndConnect(token: number, options?: SyncStartOptions): Promise<void> {
    const syncStore = useSyncStore.getState();
    const libraryStore = useLibraryStore.getState();
    syncStore.setBootstrapping(true);

    const activeView = options?.viewKey ?? libraryStore.activeViewKey;
    const defaultResolved = resolveActiveListQuery();
    const viewKey = options?.viewKey ?? defaultResolved.viewKey;
    const query = options?.initialQuery ?? defaultResolved.query;
    libraryStore.setActiveViewKey(activeView);
    libraryStore.setViewLoading(viewKey, true, false);

    try {
      const [stateRes, listRes, colsRes, tagsRes, statsRes] = await Promise.all([
        sync.getState(),
        bookmarks.list(query),
        collections.list(),
        bookmarks.tags(),
        bookmarks.stats(),
      ]);

      if (!isActive(token)) return;

      libraryStore.hydrateView(viewKey, listRes, false);
      libraryStore.hydrateCollections(colsRes.items);
      libraryStore.hydrateTags(tagsRes);
      libraryStore.hydrateStats(statsRes);
      syncStore.markSynced(stateRes.seq);
    } catch (err) {
      if (!isActive(token)) return;
      const apiErr = toApiError(err);
      libraryStore.setViewError(viewKey, apiErr.detail);
      syncStore.setError(apiErr.detail);
      syncStore.setConnectionState('offline');
      syncStore.setBootstrapping(false);
      startPolling(token);
      scheduleReconnect(token);
      return;
    }

    if (!isActive(token)) return;
    syncStore.setBootstrapping(false);
    await connectWebSocket(token);
  }

  async function start(options?: SyncStartOptions): Promise<void> {
    if (running && startPromise) {
      return startPromise;
    }
    if (running) {
      return;
    }

    running = true;
    sessionToken += 1;
    const token = sessionToken;
    useSyncStore.getState().setReconnectAttempt(0);

    startPromise = bootstrapAndConnect(token, options).finally(() => {
      if (token === sessionToken) {
        startPromise = null;
      }
    });

    return startPromise;
  }

  function stop(): void {
    running = false;
    sessionToken += 1;
    startPromise = null;
    pullInFlight = null;
    pendingPull = false;
    clearReconnectTimer();
    stopPolling();
    closeSocket();
    useSyncStore.getState().setBootstrapping(false);
    useSyncStore.getState().setSyncing(false);
    useSyncStore.getState().setConnectionState('offline');
  }

  async function pullNow(): Promise<void> {
    if (!running) return;
    await pullChangesInternal(sessionToken);
  }

  async function pollNow(): Promise<void> {
    if (!running) return;
    await runPollTick(sessionToken);
  }

  return {
    start,
    stop,
    pullNow,
    pollNow,
    isRunning: () => running,
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;

export const syncEngine = createSyncEngine();
