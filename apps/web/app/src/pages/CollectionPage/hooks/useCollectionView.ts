import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { bookmarksApi } from '../../../api/endpoints/bookmarks';
import { collectionsApi } from '../../../api/endpoints/collections';
import { ApiError, toApiError } from '../../../api/schemas/problem';
import { reorderCollectionBookmarksAction } from '../../../shared/actions/collectionActions';
import { useAppDnd } from '../../../shared/hooks/useAppDnd';
import { useUrlState } from '../../../shared/hooks/useUrlState';
import {
  getCollectionAncestors,
  getSiblingCollections,
} from '../../../shared/utils/collectionTree';
import { buildBookmarkApiQuery } from '../../../shared/utils/searchFilters';
import {
  buildCollectionViewKey,
  selectViewBookmarks,
  useLibraryStore,
} from '../../../stores/libraryStore';
import { useSyncStore } from '../../../stores/syncStore';

const EMPTY_IDS: string[] = [];

export function useCollectionView() {
  const { collectionId = '' } = useParams<{ collectionId: string }>();
  const {
    urlState,
    filters,
    hasFilters,
    hasSearchOrFilters,
    setSort,
    setLayout: setLayoutMode,
    setSearch,
    setType,
    addTag,
    removeTag,
    toggleTag,
    setFavorite,
    setNotag,
    setBroken,
    setFile,
    setCreatedRange,
    setMatchOr,
    clearFilters,
    clearSearchAndFilters,
  } = useUrlState({ allowManualSort: true });

  const sort = urlState.sort;
  const layoutMode = urlState.layout;
  const viewKey = useMemo(
    () => buildCollectionViewKey(collectionId, sort, filters),
    [collectionId, filters, sort],
  );

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
  const searchError = useLibraryStore((s) => s.searchError);
  const setSearchError = useLibraryStore((s) => s.setSearchError);
  const clearSearchError = useLibraryStore((s) => s.clearSearchError);
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
  const ancestors = useMemo(
    () => (collectionId ? getCollectionAncestors(collectionsById, collectionId) : []),
    [collectionId, collectionsById],
  );
  const childCollections = useMemo(
    () => (collectionId ? getSiblingCollections(collectionsById, collectionId) : []),
    [collectionId, collectionsById],
  );

  useEffect(() => {
    if (collection) {
      seenCollectionIdsRef.current.add(collection.id);
    }
  }, [collection]);

  // Memoized so the array identity only changes when the view contents or a
  // bookmark in it actually changes — memoized rows below then skip re-render.
  const items = useMemo(
    () =>
      selectViewBookmarks(
        {
          views: viewState ? { [viewKey]: viewState } : {},
          bookmarksById,
        } as Parameters<typeof selectViewBookmarks>[0],
        viewKey,
      ),
    [bookmarksById, viewKey, viewState],
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
    const apiQuery = buildBookmarkApiQuery({
      collectionId,
      sort,
      filters,
      page,
    });
    setViewLoading(viewKey, true, append);
    try {
      const res = await bookmarksApi.list(apiQuery);
      hydrateView(viewKey, res, append);
      clearSearchError();
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr instanceof ApiError && apiErr.status === 404) {
        setNotFoundCollectionId(collectionId);
      } else if (apiErr instanceof ApiError && apiErr.status === 400 && apiQuery.search) {
        setSearchError({
          query: apiQuery.search,
          status: apiErr.status,
          code: apiErr.code,
          detail: apiErr.detail,
        });
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
    const storeState = useLibraryStore.getState();
    const existingView = storeState.views[viewKey];
    if (
      existingView &&
      !existingView.loading &&
      (!existingView.error || storeState.searchError !== null)
    ) {
      return;
    }
    const inFlightViewKeys = inFlightViewKeysRef.current;
    if (inFlightViewKeys.has(viewKey)) {
      return;
    }

    const apiQuery = buildBookmarkApiQuery({
      collectionId,
      sort,
      filters,
      page: 1,
    });

    inFlightViewKeys.add(viewKey);
    setViewLoading(viewKey, true, false);
    let cancelled = false;
    void bookmarksApi
      .list(apiQuery)
      .then((res) => {
        inFlightViewKeys.delete(viewKey);
        if (!cancelled) {
          hydrateView(viewKey, res, false);
          clearSearchError();
        }
      })
      .catch((err) => {
        inFlightViewKeys.delete(viewKey);
        if (cancelled) return;
        const apiErr = toApiError(err);
        if (apiErr instanceof ApiError && apiErr.status === 404) {
          setNotFoundCollectionId(collectionId);
        } else if (apiErr instanceof ApiError && apiErr.status === 400 && apiQuery.search) {
          setSearchError({
            query: apiQuery.search,
            status: apiErr.status,
            code: apiErr.code,
            detail: apiErr.detail,
          });
        }
        setViewError(viewKey, apiErr.detail);
      });
    return () => {
      cancelled = true;
      inFlightViewKeys.delete(viewKey);
    };
  }, [
    clearSearchError,
    collectionId,
    collectionNotFound,
    filters,
    hydrateView,
    isBootstrapping,
    setSearchError,
    setViewError,
    setViewLoading,
    sort,
    viewKey,
  ]);

  useEffect(() => {
    if (!collectionId || sort !== 'manual' || hasSearchOrFilters) {
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
  }, [collectionId, hasSearchOrFilters, orderedIds, setManualSortContext, sort, viewKey]);

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
    childCollections,
    collectionNotFound,
    sort,
    viewKey,
    layoutMode,
    filters,
    hasFilters,
    hasSearchOrFilters,
    searchError,
    setLayoutMode,
    setSort,
    setSearch,
    setType,
    addTag,
    removeTag,
    toggleTag,
    setFavorite,
    setNotag,
    setBroken,
    setFile,
    setCreatedRange,
    setMatchOr,
    clearFilters,
    clearSearchAndFilters,
    items,
    totalCount:
      viewState?.totalCount ??
      (hasSearchOrFilters ? items.length : (collection?.bookmarkCount ?? items.length)),
    hasMore: viewState?.hasMore ?? false,
    loading:
      !collectionNotFound &&
      (viewState?.loading ?? (!viewState && (isBootstrapping || Boolean(collectionId)))) &&
      items.length === 0,
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
