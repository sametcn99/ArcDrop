import { create } from 'zustand';

export type SyncConnectionState = 'live' | 'polling' | 'offline';

export interface SyncStateStore {
  connectionState: SyncConnectionState;
  cursor: string;
  isBootstrapping: boolean;
  isSyncing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  reconnectAttempt: number;
  setConnectionState: (state: SyncConnectionState) => void;
  setCursor: (cursor: string) => void;
  setBootstrapping: (bootstrapping: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  markSynced: (cursor: string, syncedAt?: string) => void;
  setError: (error: string | null) => void;
  setReconnectAttempt: (attempt: number) => void;
  reset: () => void;
}

const INITIAL_SYNC_STATE = {
  connectionState: 'offline' as SyncConnectionState,
  cursor: '0',
  isBootstrapping: false,
  isSyncing: false,
  lastSyncedAt: null as string | null,
  lastError: null as string | null,
  reconnectAttempt: 0,
};

export const useSyncStore = create<SyncStateStore>((set) => ({
  ...INITIAL_SYNC_STATE,

  setConnectionState(connectionState) {
    set({ connectionState });
  },

  setCursor(cursor) {
    set({ cursor });
  },

  setBootstrapping(isBootstrapping) {
    set({ isBootstrapping });
  },

  setSyncing(isSyncing) {
    set({ isSyncing });
  },

  markSynced(cursor, syncedAt = new Date().toISOString()) {
    set({
      cursor,
      lastSyncedAt: syncedAt,
      lastError: null,
    });
  },

  setError(lastError) {
    set({ lastError });
  },

  setReconnectAttempt(reconnectAttempt) {
    set({ reconnectAttempt });
  },

  reset() {
    set({ ...INITIAL_SYNC_STATE });
  },
}));
