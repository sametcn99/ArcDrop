import { create } from 'zustand';
import type {
  Bookmark,
  BookmarkListResponse,
  BookmarkSort,
  BookmarkStats,
  Highlight,
  TagSummary,
  TagUsage,
} from '../api/schemas/bookmarks';
import type { Collection, CollectionSnapshot } from '../api/schemas/collections';
import type { HighlightSnapshot, SyncChange, TagSnapshot } from '../api/schemas/sync';
import {
  DEFAULT_LIBRARY_PAGE_SIZE,
  EMPTY_FILTER_STATE,
  hasActiveSearchOrFilters,
  parseFilterState,
  serializeFilterKey,
  type BookmarkFilterState,
  type LibraryLayoutMode,
  type LibraryScope,
} from '../shared/utils/searchFilters';

export { DEFAULT_LIBRARY_PAGE_SIZE, type LibraryLayoutMode, type LibraryScope };

export const TREE_EXPANDED_STORAGE_KEY = 'arcdrop.collectionTree.expanded';

export interface SearchErrorState {
  query: string;
  status: number;
  code: string;
  detail: string;
}

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
  highlightsLoadedByBookmarkId: Record<string, boolean>;
  stats: BookmarkStats;
  views: Record<string, LibraryViewState>;
  activeViewKey: string;
  layoutMode: LibraryLayoutMode;
  searchError: SearchErrorState | null;
  selectedBookmarkIds: Record<string, true>;
  pendingOptimistic: Record<string, Bookmark>;
  expandedCollectionIds: Record<string, boolean>;
  collectionsLoaded: boolean;
  setLayoutMode: (mode: LibraryLayoutMode) => void;
  setActiveViewKey: (viewKey: string) => void;
  setSearchError: (error: SearchErrorState | null) => void;
  clearSearchError: () => void;
  setViewLoading: (viewKey: string, loading: boolean, append?: boolean) => void;
  setViewError: (viewKey: string, error: string | null) => void;
  hydrateView: (viewKey: string, response: BookmarkListResponse, append?: boolean) => void;
  hydrateCollections: (collections: Collection[]) => void;
  hydrateTags: (tags: TagUsage[]) => void;
  hydrateStats: (stats: BookmarkStats) => void;
  hydrateHighlights: (bookmarkId: string, highlights: Highlight[]) => void;
  upsertHighlight: (highlight: Highlight) => void;
  removeHighlight: (bookmarkId: string, highlightId: string) => void;
  renameOrMergeTagInLibrary: (currentName: string, survivingTag: TagSummary) => void;
  removeTagFromLibrary: (tagName: string) => void;
  upsertBookmark: (bookmark: Bookmark) => void;
  beginOptimisticBookmark: (id: string, patch: Partial<Bookmark>) => void;
  commitOptimisticBookmark: (id: string, confirmed: Bookmark) => void;
  rollbackOptimisticBookmark: (id: string) => void;
  upsertCollection: (collection: Collection) => void;
  removeCollections: (ids: string[]) => void;
  applyCollectionOrder: (items: { id: string; order: number }[]) => Record<string, Collection>;
  restoreCollectionsSnapshot: (snapshot: Record<string, Collection>) => void;
  setCollectionShareState: (collectionId: string, share: Collection['share']) => void;
  adjustCollectionBookmarkCount: (collectionId: string, delta: number) => void;
  addBookmarkToCollectionViews: (collectionId: string, bookmark: Bookmark) => void;
  reorderViewIds: (viewKey: string, orderedIds: string[]) => string[] | null;
  toggleCollectionExpanded: (id: string) => void;
  setCollectionExpanded: (id: string, expanded: boolean) => void;
  syncExpandedFromStorage: () => void;
  applySyncChanges: (changes: SyncChange[]) => void;
  toggleBookmarkSelection: (id: string) => void;
  selectBookmarks: (ids: string[]) => void;
  clearSelection: () => void;
  reset: () => void;
}

export const COLLECTION_VIEW_PREFIX = 'collection:';

export function buildLibraryViewKey(
  scope: LibraryScope,
  sort: BookmarkSort,
  filters?: BookmarkFilterState,
): string {
  const base = `${scope}|${sort}`;
  const filterKey = filters ? serializeFilterKey(filters) : '';
  return filterKey ? `${base}?${filterKey}` : base;
}

export function buildCollectionViewKey(
  collectionId: string,
  sort: BookmarkSort,
  filters?: BookmarkFilterState,
): string {
  const base = `${COLLECTION_VIEW_PREFIX}${collectionId}|${sort}`;
  const filterKey = filters ? serializeFilterKey(filters) : '';
  return filterKey ? `${base}?${filterKey}` : base;
}

export function parseViewKey(viewKey: string):
  | {
      kind: 'collection';
      collectionId: string;
      sort: BookmarkSort;
      filters: BookmarkFilterState;
      hasFilters: boolean;
    }
  | {
      kind: 'library';
      scope: LibraryScope;
      sort: BookmarkSort;
      filters: BookmarkFilterState;
      hasFilters: boolean;
    } {
  const pipeIdx = viewKey.indexOf('|');
  const rawScope = pipeIdx === -1 ? viewKey : viewKey.slice(0, pipeIdx);
  const rest = pipeIdx === -1 ? '' : viewKey.slice(pipeIdx + 1);
  const queryIdx = rest.indexOf('?');
  const rawSort = queryIdx === -1 ? rest : rest.slice(0, queryIdx);
  const rawFilterQuery = queryIdx === -1 ? '' : rest.slice(queryIdx + 1);

  const sort: BookmarkSort =
    rawSort === 'created' || rawSort === 'title' || rawSort === 'manual' ? rawSort : 'updated';
  const filters = rawFilterQuery
    ? parseFilterState(new URLSearchParams(rawFilterQuery))
    : EMPTY_FILTER_STATE;
  const hasFilters = hasActiveSearchOrFilters(filters);

  if (rawScope.startsWith(COLLECTION_VIEW_PREFIX)) {
    const collectionId = rawScope.slice(COLLECTION_VIEW_PREFIX.length);
    if (collectionId) {
      return { kind: 'collection', collectionId, sort, filters, hasFilters };
    }
  }

  const scope: LibraryScope =
    rawScope === 'favorites' || rawScope === 'unassigned' ? rawScope : 'all';
  return {
    kind: 'library',
    scope,
    sort: sort === 'manual' ? 'updated' : sort,
    filters,
    hasFilters,
  };
}

function readPersistedExpandedIds(): Record<string, boolean> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(TREE_EXPANDED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writePersistedExpandedIds(expanded: Record<string, boolean>): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(TREE_EXPANDED_STORAGE_KEY, JSON.stringify(expanded));
  } catch {
    // Ignore storage quota or security errors.
  }
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
  const parsed = parseViewKey(viewKey);
  if (parsed.hasFilters) {
    // Filtered / searched views are evaluated server-side; keep explicit server fetches authoritative.
    return false;
  }
  if (parsed.kind === 'collection') {
    // BookmarkDto does not include collectionIds; keep explicit collection fetches authoritative.
    return false;
  }
  if (parsed.scope === 'favorites') {
    return bookmark.favorite;
  }
  // We cannot determine unassigned status solely from BookmarkDto because collection memberships live on collections.
  if (parsed.scope === 'unassigned') {
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
    const parsed = parseViewKey(key);
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
      // Only evict from filtered, collection, or unassigned views if the bookmark itself was trashed.
      const keepUnlessTrashed =
        parsed.hasFilters ||
        parsed.kind === 'collection' ||
        (parsed.kind === 'library' && parsed.scope === 'unassigned');
      if (!keepUnlessTrashed || bookmark.deletedAt !== null) {
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
    highlightsLoadedByBookmarkId: {} as Record<string, boolean>,
    stats: { ...INITIAL_STATS },
    views: {} as Record<string, LibraryViewState>,
    activeViewKey: buildLibraryViewKey('all', 'updated'),
    layoutMode: 'list' as LibraryLayoutMode,
    searchError: null as SearchErrorState | null,
    selectedBookmarkIds: {} as Record<string, true>,
    pendingOptimistic: {} as Record<string, Bookmark>,
    expandedCollectionIds: {} as Record<string, boolean>,
    collectionsLoaded: false,
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

  setSearchError(searchError) {
    set({ searchError });
  },

  clearSearchError() {
    if (get().searchError !== null) {
      set({ searchError: null });
    }
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
    set({ collectionsById: next, collectionsLoaded: true });
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

  hydrateHighlights(bookmarkId, highlights) {
    set((state) => {
      const nextMap: Record<string, HighlightSnapshot> = {};
      for (const highlight of highlights) {
        nextMap[highlight.id] = highlight;
      }
      return {
        highlightsByBookmarkId: {
          ...state.highlightsByBookmarkId,
          [bookmarkId]: nextMap,
        },
        highlightsLoadedByBookmarkId: {
          ...state.highlightsLoadedByBookmarkId,
          [bookmarkId]: true,
        },
      };
    });
  },

  upsertHighlight(highlight) {
    set((state) => {
      const existingForBookmark = state.highlightsByBookmarkId[highlight.bookmarkId] ?? {};
      return {
        highlightsByBookmarkId: {
          ...state.highlightsByBookmarkId,
          [highlight.bookmarkId]: {
            ...existingForBookmark,
            [highlight.id]: highlight,
          },
        },
      };
    });
  },

  removeHighlight(bookmarkId, highlightId) {
    set((state) => {
      const existingForBookmark = state.highlightsByBookmarkId[bookmarkId];
      if (!existingForBookmark || !existingForBookmark[highlightId]) {
        return state;
      }
      const nextForBookmark = { ...existingForBookmark };
      delete nextForBookmark[highlightId];
      return {
        highlightsByBookmarkId: {
          ...state.highlightsByBookmarkId,
          [bookmarkId]: nextForBookmark,
        },
      };
    });
  },

  renameOrMergeTagInLibrary(currentName, survivingTag) {
    const normalizedSource = currentName.trim().toLowerCase();
    set((state) => {
      const nextBookmarks: Record<string, Bookmark> = { ...state.bookmarksById };
      for (const [id, bookmark] of Object.entries(state.bookmarksById)) {
        const hasMatch = bookmark.tags.some((tag) => tag.name.toLowerCase() === normalizedSource);
        if (!hasMatch) continue;
        const deduped: TagSummary[] = [];
        const seenIds = new Set<string>();
        for (const tag of bookmark.tags) {
          const resolved = tag.name.toLowerCase() === normalizedSource ? survivingTag : tag;
          if (!seenIds.has(resolved.id)) {
            seenIds.add(resolved.id);
            deduped.push(resolved);
          }
        }
        nextBookmarks[id] = {
          ...bookmark,
          tags: deduped,
        };
      }
      return { bookmarksById: nextBookmarks };
    });
  },

  removeTagFromLibrary(tagName) {
    const normalized = tagName.trim().toLowerCase();
    set((state) => {
      const nextBookmarks: Record<string, Bookmark> = { ...state.bookmarksById };
      for (const [id, bookmark] of Object.entries(state.bookmarksById)) {
        const filtered = bookmark.tags.filter((tag) => tag.name.toLowerCase() !== normalized);
        if (filtered.length !== bookmark.tags.length) {
          nextBookmarks[id] = {
            ...bookmark,
            tags: filtered,
          };
        }
      }
      const nextTags: Record<string, TagUsage> = {};
      for (const [id, tag] of Object.entries(state.tagsById)) {
        if (tag.name.toLowerCase() !== normalized) {
          nextTags[id] = tag;
        }
      }
      return {
        bookmarksById: nextBookmarks,
        tagsById: nextTags,
      };
    });
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

  upsertCollection(collection) {
    set((state) => ({
      collectionsById: {
        ...state.collectionsById,
        [collection.id]: collection,
      },
      collectionsLoaded: true,
    }));
  },

  removeCollections(ids) {
    if (ids.length === 0) return;
    const removeSet = new Set(ids);
    set((state) => {
      const nextCollections = { ...state.collectionsById };
      for (const id of ids) {
        delete nextCollections[id];
      }
      const nextViews: Record<string, LibraryViewState> = {};
      for (const [key, view] of Object.entries(state.views)) {
        const parsed = parseViewKey(key);
        if (parsed.kind === 'collection' && removeSet.has(parsed.collectionId)) {
          continue;
        }
        nextViews[key] = view;
      }
      return {
        collectionsById: nextCollections,
        views: nextViews,
      };
    });
  },

  applyCollectionOrder(items) {
    const previous = get().collectionsById;
    set((state) => {
      const nextCollections = { ...state.collectionsById };
      for (const item of items) {
        const existing = nextCollections[item.id];
        if (existing) {
          nextCollections[item.id] = {
            ...existing,
            order: item.order,
          };
        }
      }
      return { collectionsById: nextCollections };
    });
    return previous;
  },

  restoreCollectionsSnapshot(snapshot) {
    set({ collectionsById: snapshot });
  },

  setCollectionShareState(collectionId, share) {
    set((state) => {
      const existing = state.collectionsById[collectionId];
      if (!existing) return state;
      return {
        collectionsById: {
          ...state.collectionsById,
          [collectionId]: {
            ...existing,
            share,
          },
        },
      };
    });
  },

  adjustCollectionBookmarkCount(collectionId, delta) {
    if (delta === 0) return;
    set((state) => {
      const existing = state.collectionsById[collectionId];
      if (!existing) return state;
      return {
        collectionsById: {
          ...state.collectionsById,
          [collectionId]: {
            ...existing,
            bookmarkCount: Math.max(0, existing.bookmarkCount + delta),
          },
        },
      };
    });
  },

  addBookmarkToCollectionViews(collectionId, bookmark) {
    if (bookmark.deletedAt !== null) return;
    set((state) => {
      const prefix = `${COLLECTION_VIEW_PREFIX}${collectionId}|`;
      let changed = false;
      const nextViews = { ...state.views };
      for (const [key, view] of Object.entries(state.views)) {
        if (!key.startsWith(prefix)) continue;
        if (parseViewKey(key).hasFilters) continue;
        if (view.ids.includes(bookmark.id)) continue;
        changed = true;
        nextViews[key] = {
          ...view,
          ids: [...view.ids, bookmark.id],
          totalCount: view.totalCount + 1,
        };
      }
      return changed ? { views: nextViews } : state;
    });
  },

  reorderViewIds(viewKey, orderedIds) {
    const currentView = get().views[viewKey];
    if (!currentView) return null;
    const previousIds = currentView.ids;
    set((state) => {
      const view = state.views[viewKey];
      if (!view) return state;
      return {
        views: {
          ...state.views,
          [viewKey]: {
            ...view,
            ids: orderedIds,
          },
        },
      };
    });
    return previousIds;
  },

  toggleCollectionExpanded(id) {
    set((state) => {
      const next = {
        ...state.expandedCollectionIds,
        [id]: !state.expandedCollectionIds[id],
      };
      writePersistedExpandedIds(next);
      return { expandedCollectionIds: next };
    });
  },

  setCollectionExpanded(id, expanded) {
    set((state) => {
      if (Boolean(state.expandedCollectionIds[id]) === expanded) {
        return state;
      }
      const next = {
        ...state.expandedCollectionIds,
        [id]: expanded,
      };
      writePersistedExpandedIds(next);
      return { expandedCollectionIds: next };
    });
  },

  syncExpandedFromStorage() {
    const persisted = readPersistedExpandedIds();
    if (Object.keys(persisted).length === 0) return;
    set((state) => ({
      expandedCollectionIds: {
        ...persisted,
        ...state.expandedCollectionIds,
      },
    }));
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
      const nextHighlightsLoaded = { ...state.highlightsLoadedByBookmarkId };
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
            delete nextHighlightsLoaded[change.id];
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
        highlightsLoadedByBookmarkId: nextHighlightsLoaded,
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

export function compareCollections(a: Collection, b: Collection): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
  return a.id.localeCompare(b.id);
}

export function selectSortedCollections(state: LibraryState): Collection[] {
  return Object.values(state.collectionsById).sort(compareCollections);
}

export function selectSortedTags(state: LibraryState): TagUsage[] {
  return Object.values(state.tagsById).sort((a, b) => a.name.localeCompare(b.name));
}

export function selectBookmarkHighlights(
  state: LibraryState,
  bookmarkId: string,
): HighlightSnapshot[] {
  const map = state.highlightsByBookmarkId[bookmarkId];
  if (!map) return [];
  return Object.values(map).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function selectSelectedBookmarkIdsList(state: LibraryState): string[] {
  return Object.keys(state.selectedBookmarkIds);
}
