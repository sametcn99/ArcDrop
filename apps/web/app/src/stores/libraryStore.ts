import { create } from 'zustand';
import type {
  Bookmark,
  BookmarkListResponse,
  BookmarkSort,
  BookmarkStats,
  TagUsage,
} from '../api/schemas/bookmarks';
import type { Collection, CollectionSnapshot } from '../api/schemas/collections';
import type { HighlightSnapshot, SyncChange, TagSnapshot } from '../api/schemas/sync';

export type LibraryLayoutMode = 'list' | 'grid' | 'headlines' | 'moodboard';
export type LibraryScope = 'all' | 'favorites' | 'unassigned';

export interface LibraryViewState {
  ids: string[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
}

export interface LibraryState {
  bookmarksById: Record<string, Bookmark>;
  collectionsById: Record<string, Collection>;
  tagsById: Record<string, TagUsage>;
  highlightsByBookmarkId: Record<string, Record<string, HighlightSnapshot>>;
  stats: BookmarkStats;
  views: Record<string, LibraryViewState>;
  activeViewKey: string;
  layoutMode: LibraryLayoutMode;
  selectedBookmarkIds: Record<string, true>;
  pendingOptimistic: Record<string, Bookmark>;
  setLayoutMode: (mode: LibraryLayoutMode) => void;
  setActiveViewKey: (viewKey: string) => void;
  setViewLoading: (viewKey: string, loading: boolean, append?: boolean) => void;
  setViewError: (viewKey: string, error: string | null) => void;
  hydrateView: (viewKey: string, response: BookmarkListResponse, append?: boolean) => void;
  hydrateCollections: (collections: Collection[]) => void;
  hydrateTags: (tags: TagUsage[]) => void;
  hydrateStats: (stats: BookmarkStats) => void;
  upsertBookmark: (bookmark: Bookmark) => void;
  beginOptimisticBookmark: (id: string, patch: Partial<Bookmark>) => void;
  commitOptimisticBookmark: (id: string, confirmed: Bookmark) => void;
  rollbackOptimisticBookmark: (id: string) => void;
  applySyncChanges: (changes: SyncChange[]) => void;
  toggleBookmarkSelection: (id: string) => void;
  selectBookmarks: (ids: string[]) => void;
  clearSelection: () => void;
  reset: () => void;
}

export const DEFAULT_LIBRARY_PAGE_SIZE = 24;

export function buildLibraryViewKey(scope: LibraryScope, sort: BookmarkSort): string {
  return `${scope}|${sort}`;
}

function createEmptyView(): LibraryViewState {
  return {
    ids: [],
    totalCount: 0,
    page: 1,
    pageSize: DEFAULT_LIBRARY_PAGE_SIZE,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: null,
  };
}

function isBookmarkSnapshot(snapshot: SyncChange['snapshot']): snapshot is Bookmark {
  return snapshot !== null && 'storageKind' in snapshot;
}

function isCollectionSnapshot(snapshot: SyncChange['snapshot']): snapshot is CollectionSnapshot {
  return snapshot !== null && 'share' in snapshot && 'deletedAt' in snapshot;
}

function isTagSnapshot(snapshot: SyncChange['snapshot']): snapshot is TagSnapshot {
  return (
    snapshot !== null &&
    'name' in snapshot &&
    !('storageKind' in snapshot) &&
    !('share' in snapshot) &&
    !('bookmarkId' in snapshot)
  );
}

function isHighlightSnapshot(snapshot: SyncChange['snapshot']): snapshot is HighlightSnapshot {
  return snapshot !== null && 'bookmarkId' in snapshot && 'text' in snapshot;
}

function viewMatchesBookmark(viewKey: string, bookmark: Bookmark): boolean {
  if (bookmark.deletedAt !== null) {
    return false;
  }
  const [scope] = viewKey.split('|');
  if (scope === 'favorites') {
    return bookmark.favorite;
  }
  // We cannot determine unassigned status solely from BookmarkDto because collection memberships live on collections.
  // For 'unassigned', keep existing membership or let explicit list fetches govern inclusion unless removed.
  if (scope === 'unassigned') {
    return false;
  }
  return true;
}

function removeIdFromViews(
  views: Record<string, LibraryViewState>,
  id: string,
): Record<string, LibraryViewState> {
  let changed = false;
  const nextViews: Record<string, LibraryViewState> = { ...views };
  for (const [key, view] of Object.entries(views)) {
    if (!view.ids.includes(id)) continue;
    changed = true;
    nextViews[key] = {
      ...view,
      ids: view.ids.filter((itemId) => itemId !== id),
      totalCount: Math.max(0, view.totalCount - 1),
    };
  }
  return changed ? nextViews : views;
}

function insertBookmarkIntoViews(
  views: Record<string, LibraryViewState>,
  bookmark: Bookmark,
): Record<string, LibraryViewState> {
  const nextViews: Record<string, LibraryViewState> = { ...views };
  let changed = false;

  for (const [key, view] of Object.entries(views)) {
    const matches = viewMatchesBookmark(key, bookmark);
    const alreadyInView = view.ids.includes(bookmark.id);

    if (matches && !alreadyInView) {
      changed = true;
      nextViews[key] = {
        ...view,
        ids: [bookmark.id, ...view.ids],
        totalCount: view.totalCount + 1,
      };
    } else if (!matches && alreadyInView) {
      const [scope] = key.split('|');
      // Only evict from 'unassigned' if the bookmark itself was trashed.
      if (scope !== 'unassigned' || bookmark.deletedAt !== null) {
        changed = true;
        nextViews[key] = {
          ...view,
          ids: view.ids.filter((itemId) => itemId !== bookmark.id),
          totalCount: Math.max(0, view.totalCount - 1),
        };
      }
    }
  }

  return changed ? nextViews : views;
}

const INITIAL_STATS: BookmarkStats = {
  total: 0,
  unassigned: 0,
  trashed: 0,
  favorites: 0,
};

function createInitialLibraryState() {
  return {
    bookmarksById: {} as Record<string, Bookmark>,
    collectionsById: {} as Record<string, Collection>,
    tagsById: {} as Record<string, TagUsage>,
    highlightsByBookmarkId: {} as Record<string, Record<string, HighlightSnapshot>>,
    stats: { ...INITIAL_STATS },
    views: {} as Record<string, LibraryViewState>,
    activeViewKey: buildLibraryViewKey('all', 'updated'),
    layoutMode: 'list' as LibraryLayoutMode,
    selectedBookmarkIds: {} as Record<string, true>,
    pendingOptimistic: {} as Record<string, Bookmark>,
  };
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  ...createInitialLibraryState(),

  setLayoutMode(layoutMode) {
    set({ layoutMode });
  },

  setActiveViewKey(activeViewKey) {
    set({ activeViewKey });
  },

  setViewLoading(viewKey, loading, append = false) {
    set((state) => {
      const existing = state.views[viewKey] ?? createEmptyView();
      return {
        views: {
          ...state.views,
          [viewKey]: {
            ...existing,
            loading: append ? existing.loading : loading,
            loadingMore: append ? loading : false,
            error: loading ? null : existing.error,
          },
        },
      };
    });
  },

  setViewError(viewKey, error) {
    set((state) => {
      const existing = state.views[viewKey] ?? createEmptyView();
      return {
        views: {
          ...state.views,
          [viewKey]: {
            ...existing,
            loading: false,
            loadingMore: false,
            error,
          },
        },
      };
    });
  },

  hydrateView(viewKey, response, append = false) {
    set((state) => {
      const existing = state.views[viewKey] ?? createEmptyView();
      const nextBookmarks = { ...state.bookmarksById };
      const incomingIds: string[] = [];

      for (const item of response.items) {
        // Respect active in-flight optimistic edit if present so transient UI state does not flicker.
        if (!state.pendingOptimistic[item.id]) {
          nextBookmarks[item.id] = item;
        }
        incomingIds.push(item.id);
      }

      const mergedIds = append
        ? [...existing.ids, ...incomingIds.filter((id) => !existing.ids.includes(id))]
        : incomingIds;

      const hasMore = mergedIds.length < response.totalCount;

      return {
        bookmarksById: nextBookmarks,
        views: {
          ...state.views,
          [viewKey]: {
            ids: mergedIds,
            totalCount: response.totalCount,
            page: response.page,
            pageSize: response.pageSize,
            hasMore,
            loading: false,
            loadingMore: false,
            error: null,
          },
        },
      };
    });
  },

  hydrateCollections(collections) {
    const next: Record<string, Collection> = {};
    for (const col of collections) {
      next[col.id] = col;
    }
    set({ collectionsById: next });
  },

  hydrateTags(tags) {
    const next: Record<string, TagUsage> = {};
    for (const tag of tags) {
      next[tag.id] = tag;
    }
    set({ tagsById: next });
  },

  hydrateStats(stats) {
    set({ stats });
  },

  upsertBookmark(bookmark) {
    set((state) => {
      const nextBookmarks = {
        ...state.bookmarksById,
        [bookmark.id]: bookmark,
      };
      const nextPending = { ...state.pendingOptimistic };
      delete nextPending[bookmark.id];
      const nextViews = insertBookmarkIntoViews(state.views, bookmark);
      return {
        bookmarksById: nextBookmarks,
        pendingOptimistic: nextPending,
        views: nextViews,
      };
    });
  },

  beginOptimisticBookmark(id, patch) {
    set((state) => {
      const current = state.bookmarksById[id];
      if (!current) {
        return state;
      }
      const nextPending = state.pendingOptimistic[id]
        ? state.pendingOptimistic
        : { ...state.pendingOptimistic, [id]: current };

      const updated: Bookmark = {
        ...current,
        ...patch,
      };

      return {
        bookmarksById: {
          ...state.bookmarksById,
          [id]: updated,
        },
        pendingOptimistic: nextPending,
      };
    });
  },

  commitOptimisticBookmark(id, confirmed) {
    set((state) => {
      const previous = state.pendingOptimistic[id] ?? state.bookmarksById[id];
      const nextPending = { ...state.pendingOptimistic };
      delete nextPending[id];

      const nextStats = { ...state.stats };
      if (previous) {
        const wasActive = previous.deletedAt === null;
        const isActive = confirmed.deletedAt === null;
        if (wasActive && !isActive) {
          nextStats.total = Math.max(0, nextStats.total - 1);
          nextStats.trashed += 1;
          if (previous.favorite) {
            nextStats.favorites = Math.max(0, nextStats.favorites - 1);
          }
        } else if (!wasActive && isActive) {
          nextStats.total += 1;
          nextStats.trashed = Math.max(0, nextStats.trashed - 1);
          if (confirmed.favorite) {
            nextStats.favorites += 1;
          }
        } else if (isActive && previous.favorite !== confirmed.favorite) {
          nextStats.favorites = Math.max(0, nextStats.favorites + (confirmed.favorite ? 1 : -1));
        }
      }

      const nextViews = insertBookmarkIntoViews(state.views, confirmed);

      return {
        bookmarksById: {
          ...state.bookmarksById,
          [id]: confirmed,
        },
        pendingOptimistic: nextPending,
        stats: nextStats,
        views: nextViews,
      };
    });
  },

  rollbackOptimisticBookmark(id) {
    const previous = get().pendingOptimistic[id];
    if (!previous) return;
    set((state) => {
      const nextPending = { ...state.pendingOptimistic };
      delete nextPending[id];
      return {
        bookmarksById: {
          ...state.bookmarksById,
          [id]: previous,
        },
        pendingOptimistic: nextPending,
      };
    });
  },

  applySyncChanges(changes) {
    if (changes.length === 0) return;

    // Enforce strict ascending seq order regardless of delivery order.
    const sorted = [...changes].sort((a, b) => {
      const seqA = BigInt(a.seq);
      const seqB = BigInt(b.seq);
      if (seqA < seqB) return -1;
      if (seqA > seqB) return 1;
      return 0;
    });

    set((state) => {
      const nextBookmarks = { ...state.bookmarksById };
      const nextCollections = { ...state.collectionsById };
      const nextTags = { ...state.tagsById };
      const nextHighlights = { ...state.highlightsByBookmarkId };
      const nextPending = { ...state.pendingOptimistic };
      const nextSelected = { ...state.selectedBookmarkIds };
      let nextViews = state.views;
      const nextStats = { ...state.stats };

      for (const change of sorted) {
        if (change.entity === 'bookmark') {
          const prev = nextPending[change.id] ?? nextBookmarks[change.id];

          if (change.action === 'delete' || change.snapshot === null) {
            if (prev) {
              if (prev.deletedAt === null) {
                nextStats.total = Math.max(0, nextStats.total - 1);
                if (prev.favorite) {
                  nextStats.favorites = Math.max(0, nextStats.favorites - 1);
                }
              } else {
                nextStats.trashed = Math.max(0, nextStats.trashed - 1);
              }
            }
            delete nextBookmarks[change.id];
            delete nextPending[change.id];
            delete nextSelected[change.id];
            delete nextHighlights[change.id];
            nextViews = removeIdFromViews(nextViews, change.id);
            continue;
          }

          if (isBookmarkSnapshot(change.snapshot)) {
            const incoming = change.snapshot;
            const wasActive = prev ? prev.deletedAt === null : null;
            const isActive = incoming.deletedAt === null;

            if (wasActive === null) {
              if (isActive) {
                nextStats.total += 1;
                if (incoming.favorite) nextStats.favorites += 1;
              } else {
                nextStats.trashed += 1;
              }
            } else if (wasActive && !isActive) {
              nextStats.total = Math.max(0, nextStats.total - 1);
              nextStats.trashed += 1;
              if (prev?.favorite) {
                nextStats.favorites = Math.max(0, nextStats.favorites - 1);
              }
            } else if (!wasActive && isActive) {
              nextStats.total += 1;
              nextStats.trashed = Math.max(0, nextStats.trashed - 1);
              if (incoming.favorite) nextStats.favorites += 1;
            } else if (isActive && prev && prev.favorite !== incoming.favorite) {
              nextStats.favorites = Math.max(0, nextStats.favorites + (incoming.favorite ? 1 : -1));
            }

            nextBookmarks[change.id] = incoming;
            delete nextPending[change.id];
            nextViews = insertBookmarkIntoViews(nextViews, incoming);
          }
        } else if (change.entity === 'collection') {
          if (change.action === 'delete' || change.snapshot === null) {
            delete nextCollections[change.id];
            continue;
          }
          if (isCollectionSnapshot(change.snapshot)) {
            if (change.snapshot.deletedAt !== null) {
              delete nextCollections[change.id];
            } else {
              const prevCount = nextCollections[change.id]?.bookmarkCount ?? 0;
              nextCollections[change.id] = {
                id: change.snapshot.id,
                parentId: change.snapshot.parentId,
                title: change.snapshot.title,
                icon: change.snapshot.icon,
                color: change.snapshot.color,
                order: change.snapshot.order,
                bookmarkCount: prevCount,
                share: change.snapshot.share,
                createdAt: change.snapshot.createdAt,
                updatedAt: change.snapshot.updatedAt,
              };
            }
          }
        } else if (change.entity === 'tag') {
          if (change.action === 'delete' || change.snapshot === null) {
            delete nextTags[change.id];
            continue;
          }
          if (isTagSnapshot(change.snapshot)) {
            const prevCount = nextTags[change.id]?.count ?? 0;
            nextTags[change.id] = {
              id: change.snapshot.id,
              name: change.snapshot.name,
              count: prevCount,
            };
          }
        } else if (change.entity === 'highlight') {
          if (change.action === 'delete' || change.snapshot === null) {
            for (const [bookmarkId, map] of Object.entries(nextHighlights)) {
              if (map[change.id]) {
                const updatedMap = { ...map };
                delete updatedMap[change.id];
                nextHighlights[bookmarkId] = updatedMap;
              }
            }
            continue;
          }
          if (isHighlightSnapshot(change.snapshot)) {
            const existingForBookmark = nextHighlights[change.snapshot.bookmarkId] ?? {};
            nextHighlights[change.snapshot.bookmarkId] = {
              ...existingForBookmark,
              [change.snapshot.id]: change.snapshot,
            };
          }
        }
      }

      return {
        bookmarksById: nextBookmarks,
        collectionsById: nextCollections,
        tagsById: nextTags,
        highlightsByBookmarkId: nextHighlights,
        pendingOptimistic: nextPending,
        selectedBookmarkIds: nextSelected,
        views: nextViews,
        stats: nextStats,
      };
    });
  },

  toggleBookmarkSelection(id) {
    set((state) => {
      const next = { ...state.selectedBookmarkIds };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return { selectedBookmarkIds: next };
    });
  },

  selectBookmarks(ids) {
    const next: Record<string, true> = {};
    for (const id of ids) {
      next[id] = true;
    }
    set({ selectedBookmarkIds: next });
  },

  clearSelection() {
    set({ selectedBookmarkIds: {} });
  },

  reset() {
    set(createInitialLibraryState());
  },
}));

export function selectViewBookmarks(state: LibraryState, viewKey: string): Bookmark[] {
  const view = state.views[viewKey];
  if (!view) return [];
  const result: Bookmark[] = [];
  for (const id of view.ids) {
    const item = state.bookmarksById[id];
    if (item && item.deletedAt === null) {
      result.push(item);
    }
  }
  return result;
}

export function selectSortedCollections(state: LibraryState): Collection[] {
  return Object.values(state.collectionsById).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
    return a.id.localeCompare(b.id);
  });
}

export function selectSortedTags(state: LibraryState): TagUsage[] {
  return Object.values(state.tagsById).sort((a, b) => a.name.localeCompare(b.name));
}

export function selectSelectedBookmarkIdsList(state: LibraryState): string[] {
  return Object.keys(state.selectedBookmarkIds);
}
