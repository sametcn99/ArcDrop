import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { bookmarksApi } from '../../../api/endpoints/bookmarks';
import { collectionsApi } from '../../../api/endpoints/collections';
import type { BookmarkListQuery, BookmarkSort } from '../../../api/schemas/bookmarks';
import { ApiError, toApiError } from '../../../api/schemas/problem';
import { reorderCollectionBookmarksAction } from '../../../shared/actions/collectionActions';
import { useAppDnd } from '../../../shared/hooks/useAppDnd';
import { getCollectionAncestors } from '../../../shared/utils/collectionTree';
import {
  buildCollectionViewKey,
  DEFAULT_LIBRARY_PAGE_SIZE,
  selectViewBookmarks,
  useLibraryStore,
} from '../../../stores/libraryStore';
import { useSyncStore } from '../../../stores/syncStore';

const EMPTY_IDS: string[] = [];

function parseCollectionSort(raw: string | null): BookmarkSort {
  if (raw === 'created' || raw === 'title' || raw === 'manual') {
    return raw;
  }
  return 'updated';
}

function buildCollectionListQuery(
  collectionId: string,
  sort: BookmarkSort,
  page: number,
): BookmarkListQuery {
  return {
    page,
    pageSize: DEFAULT_LIBRARY_PAGE_SIZE,
    sort,
    collectionId,
    trashed: false,
  };
}

export function useCollectionView() {
  const { collectionId = '' } = useParams<{ collectionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = parseCollectionSort(searchParams.get('sort'));
  const viewKey = buildCollectionViewKey(collectionId, sort);

  const [notFoundCollectionId, setNotFoundCollectionId] = useState<string | null>(null);
  const [fetchErrorState, setFetchErrorState] = useState<{
    collectionId: string;
    message: string;
  } | null>(null);

  const inFlightViewKeysRef = useRef<Set<string>>(new Set());
  const seenCollectionIdsRef = useRef<Set<string>>(new Set());

  const collectionNotFound = Boolean(collectionId) && notFoundCollectionId === collectionId;
  const collectionFetchError =
    fetchErrorState?.collectionId === collectionId ? fetchErrorState.message : null;

  const collectionsById = useLibraryStore((s) => s.collectionsById);
  const collectionsLoaded = useLibraryStore((s) => s.collectionsLoaded);
  const upsertCollection = useLibraryStore((s) => s.upsertCollection);
  const viewState = useLibraryStore((s) => s.views[viewKey]);
  const layoutMode = useLibraryStore((s) => s.layoutMode);
  const setLayoutMode = useLibraryStore((s) => s.setLayoutMode);
  const setActiveViewKey = useLibraryStore((s) => s.setActiveViewKey);
  const hydrateView = useLibraryStore((s) => s.hydrateView);
  const setViewLoading = useLibraryStore((s) => s.setViewLoading);
  const setViewError = useLibraryStore((s) => s.setViewError);
  const selectedBookmarkIds = useLibraryStore((s) => s.selectedBookmarkIds);
  const toggleBookmarkSelection = useLibraryStore((s) => s.toggleBookmarkSelection);
  const bookmarksById = useLibraryStore((s) => s.bookmarksById);
  const isBootstrapping = useSyncStore((s) => s.isBootstrapping);
  const { setManualSortContext } = useAppDnd();

  const collection = collectionId ? (collectionsById[collectionId] ?? null) : null;
  const ancestors = collectionId ? getCollectionAncestors(collectionsById, collectionId) : [];

  useEffect(() => {
    if (collection) {
      seenCollectionIdsRef.current.add(collection.id);
    }
  }, [collection]);

  const items = selectViewBookmarks(
    {
      views: viewState ? { [viewKey]: viewState } : {},
      bookmarksById,
    } as Parameters<typeof selectViewBookmarks>[0],
    viewKey,
  );
  const orderedIds = viewState?.ids ?? EMPTY_IDS;

  // If navigating directly before collections arrive (or when bootstrap failed on a 404 collection), fetch this collection row once.
  useEffect(() => {
    if (
      !collectionId ||
      collection ||
      isBootstrapping ||
      (!collectionsLoaded && !viewState?.error)
    ) {
      return;
    }
    if (seenCollectionIdsRef.current.has(collectionId)) {
      return;
    }
    seenCollectionIdsRef.current.add(collectionId);
    let cancelled = false;
    void collectionsApi
      .get(collectionId)
      .then((col) => {
        if (!cancelled) upsertCollection(col);
      })
      .catch((err) => {
        if (cancelled) return;
        const apiErr = toApiError(err);
        if (apiErr instanceof ApiError && apiErr.status === 404) {
          setNotFoundCollectionId(collectionId);
        } else {
          setFetchErrorState({ collectionId, message: apiErr.detail });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    collection,
    collectionId,
    collectionsLoaded,
    isBootstrapping,
    upsertCollection,
    viewState?.error,
  ]);

  const fetchPage = async (page: number, append: boolean) => {
    if (!collectionId) return;
    setViewLoading(viewKey, true, append);
    try {
      const res = await bookmarksApi.list(buildCollectionListQuery(collectionId, sort, page));
      hydrateView(viewKey, res, append);
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr instanceof ApiError && apiErr.status === 404) {
        setNotFoundCollectionId(collectionId);
      }
      setViewError(viewKey, apiErr.detail);
    }
  };

  useEffect(() => {
    if (!collectionId) return;
    setActiveViewKey(viewKey);
  }, [collectionId, setActiveViewKey, viewKey]);

  useEffect(() => {
    if (!collectionId || isBootstrapping || collectionNotFound) {
      return;
    }
    const existingView = useLibraryStore.getState().views[viewKey];
    if (existingView && !existingView.loading) {
      return;
    }
    if (inFlightViewKeysRef.current.has(viewKey)) {
      return;
    }

    inFlightViewKeysRef.current.add(viewKey);
    setViewLoading(viewKey, true, false);
    let cancelled = false;
    void bookmarksApi
      .list(buildCollectionListQuery(collectionId, sort, 1))
      .then((res) => {
        inFlightViewKeysRef.current.delete(viewKey);
        if (!cancelled) {
          hydrateView(viewKey, res, false);
        }
      })
      .catch((err) => {
        inFlightViewKeysRef.current.delete(viewKey);
        if (cancelled) return;
        const apiErr = toApiError(err);
        if (apiErr instanceof ApiError && apiErr.status === 404) {
          setNotFoundCollectionId(collectionId);
        }
        setViewError(viewKey, apiErr.detail);
      });
    return () => {
      cancelled = true;
      inFlightViewKeysRef.current.delete(viewKey);
    };
  }, [
    collectionId,
    collectionNotFound,
    hydrateView,
    isBootstrapping,
    setViewError,
    setViewLoading,
    sort,
    viewKey,
  ]);

  useEffect(() => {
    if (!collectionId || sort !== 'manual') {
      setManualSortContext(null);
      return;
    }
    setManualSortContext({
      collectionId,
      viewKey,
      orderedIds,
    });
    return () => {
      setManualSortContext(null);
    };
  }, [collectionId, orderedIds, setManualSortContext, sort, viewKey]);

  const setSort = (nextSort: BookmarkSort) => {
    const next = new URLSearchParams(searchParams);
    if (nextSort === 'updated') {
      next.delete('sort');
    } else {
      next.set('sort', nextSort);
    }
    setSearchParams(next);
  };

  const loadMore = async () => {
    if (!viewState || !viewState.hasMore || viewState.loadingMore || viewState.loading) {
      return;
    }
    await fetchPage(viewState.page + 1, true);
  };

  const retry = () => {
    setNotFoundCollectionId(null);
    setFetchErrorState(null);
    inFlightViewKeysRef.current.delete(viewKey);
    void fetchPage(1, false);
  };

  const reorderBookmarks = useCallback(
    async (nextOrderedIds: string[]) => {
      if (!collectionId) return;
      await reorderCollectionBookmarksAction(collectionId, viewKey, nextOrderedIds).catch(
        () => undefined,
      );
    },
    [collectionId, viewKey],
  );

  const moveBookmark = useCallback(
    async (bookmarkId: string, direction: 'up' | 'down') => {
      const currentIds = orderedIds;
      const index = currentIds.indexOf(bookmarkId);
      if (index === -1) return;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= currentIds.length) return;
      const nextIds = [...currentIds];
      const [moved] = nextIds.splice(index, 1);
      if (!moved) return;
      nextIds.splice(targetIndex, 0, moved);
      await reorderBookmarks(nextIds);
    },
    [orderedIds, reorderBookmarks],
  );

  return {
    collectionId,
    collection,
    ancestors,
    collectionNotFound,
    sort,
    viewKey,
    layoutMode,
    setLayoutMode,
    setSort,
    items,
    totalCount: viewState?.totalCount ?? collection?.bookmarkCount ?? items.length,
    hasMore: viewState?.hasMore ?? false,
    loading: (viewState?.loading ?? (!viewState && isBootstrapping)) && items.length === 0,
    loadingMore: viewState?.loadingMore ?? false,
    error: viewState?.error ?? collectionFetchError,
    selectedBookmarkIds,
    toggleBookmarkSelection,
    loadMore,
    retry,
    reorderBookmarks,
    moveBookmark,
  };
}
