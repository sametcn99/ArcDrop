import { create } from 'zustand';
import type { Notification, NotificationListResponse } from '../api/schemas/notifications';
import type { SyncWsReminderNotification } from '../api/schemas/sync';

export interface NotificationsState {
  items: Notification[];
  totalCount: number;
  unreadCount: number;
  loading: boolean;
  error: string | null;
  drawerOpen: boolean;
  hydrated: boolean;
  needsRefresh: boolean;
  setDrawerOpen: (open: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  hydrateNotifications: (res: NotificationListResponse) => void;
  markOneReadLocally: (id: string, readAt: string) => void;
  markAllReadLocally: (readAt: string) => void;
  handleLiveReminderFrame: (frame: SyncWsReminderNotification) => void;
  clearNeedsRefresh: () => void;
  reset: () => void;
}

function createInitialState() {
  return {
    items: [] as Notification[],
    totalCount: 0,
    unreadCount: 0,
    loading: false,
    error: null as string | null,
    drawerOpen: false,
    hydrated: false,
    needsRefresh: false,
  };
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  ...createInitialState(),

  setDrawerOpen(drawerOpen) {
    set({ drawerOpen });
  },

  setLoading(loading) {
    set({ loading, error: loading ? null : undefined });
  },

  setError(error) {
    set({ error, loading: false });
  },

  hydrateNotifications(res) {
    const unreadCount = res.items.filter((item) => item.readAt === null).length;
    set({
      items: res.items,
      totalCount: res.totalCount,
      unreadCount,
      loading: false,
      error: null,
      hydrated: true,
      needsRefresh: false,
    });
  },

  markOneReadLocally(id, readAt) {
    set((state) => {
      let changed = false;
      const items = state.items.map((item) => {
        if (item.id === id && item.readAt === null) {
          changed = true;
          return { ...item, readAt };
        }
        return item;
      });
      return {
        items,
        unreadCount: changed ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
      };
    });
  },

  markAllReadLocally(readAt) {
    set((state) => ({
      items: state.items.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
      unreadCount: 0,
    }));
  },

  handleLiveReminderFrame(_frame) {
    set((state) => ({
      unreadCount: state.unreadCount + 1,
      needsRefresh: true,
    }));
  },

  clearNeedsRefresh() {
    set({ needsRefresh: false });
  },

  reset() {
    set(createInitialState());
  },
}));
