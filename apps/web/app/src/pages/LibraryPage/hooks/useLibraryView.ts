import { useCallback, useEffect, useMemo, useRef } from 'react';
import { bookmarksApi } from '../../../api/endpoints/bookmarks';
import { ApiError, toApiError } from '../../../api/schemas/problem';
import { useUrlState } from '../../../shared/hooks/useUrlState';
import { buildBookmarkApiQuery } from '../../../shared/utils/searchFilters';
import {
  buildLibraryViewKey,
  selectViewBookmarks,
  useLibraryStore,
} from '../../../stores/libraryStore';
import { useSyncStore } from '../../../stores/syncStore';

export function useLibraryView() {
  const {
    urlState,
    filters,
    hasFilters,
    hasSearchOrFilters,
    setView: setScope,
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
  } = useUrlState({ allowManualSort: false });

  const scope = urlState.view;
  const sort = urlState.sort === 'manual' ? 'updated' : urlState.sort;
  const layoutMode = urlState.layout;

  const viewKey = useMemo(() => buildLibraryViewKey(scope, sort, filters), [filters, scope, sort]);

  const inFlightViewKeysRef = useRef<Set<string>>(new Set());

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

  const items = selectViewBookmarks(
    {
      views: viewState ? { [viewKey]: viewState } : {},
      bookmarksById,
    } as Parameters<typeof selectViewBookmarks>[0],
    viewKey,
  );

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      const apiQuery = buildBookmarkApiQuery({
        scope,
        sort,
        filters,
        page,
      });
      if (!append) {
        inFlightViewKeysRef.current.add(viewKey);
      }
      setViewLoading(viewKey, true, append);
      try {
        const res = await bookmarksApi.list(apiQuery);
        if (!append) {
          inFlightViewKeysRef.current.delete(viewKey);
        }
        hydrateView(viewKey, res, append);
        clearSearchError();
      } catch (err) {
        if (!append) {
          inFlightViewKeysRef.current.delete(viewKey);
        }
        const apiErr = toApiError(err);
        if (apiErr instanceof ApiError && apiErr.status === 400 && apiQuery.search) {
          setSearchError({
            query: apiQuery.search,
            status: apiErr.status,
            code: apiErr.code,
            detail: apiErr.detail,
          });
        }
        setViewError(viewKey, apiErr.detail);
      }
    },
    [
      clearSearchError,
      filters,
      hydrateView,
      scope,
      setSearchError,
      setViewError,
      setViewLoading,
      sort,
      viewKey,
    ],
  );

  useEffect(() => {
    setActiveViewKey(viewKey);
  }, [setActiveViewKey, viewKey]);

  useEffect(() => {
    if (isBootstrapping) {
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
    if (inFlightViewKeysRef.current.has(viewKey)) {
      return;
    }
    void fetchPage(1, false);
  }, [fetchPage, isBootstrapping, viewKey]);

  const loadMore = async () => {
    if (!viewState || !viewState.hasMore || viewState.loadingMore || viewState.loading) {
      return;
    }
    await fetchPage(viewState.page + 1, true);
  };

  const retry = () => {
    inFlightViewKeysRef.current.delete(viewKey);
    void fetchPage(1, false);
  };

  return {
    scope,
    sort,
    viewKey,
    layoutMode,
    filters,
    hasFilters,
    hasSearchOrFilters,
    searchError,
    setLayoutMode,
    setScope,
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
    totalCount: viewState?.totalCount ?? items.length,
    hasMore: viewState?.hasMore ?? false,
    loading: (viewState?.loading ?? !viewState) && items.length === 0,
    loadingMore: viewState?.loadingMore ?? false,
    error: viewState?.error ?? null,
    selectedBookmarkIds,
    toggleBookmarkSelection,
    loadMore,
    retry,
  };
}
