import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { bookmarksApi } from '../../../api/endpoints/bookmarks';
import type { BookmarkListQuery, BookmarkSort } from '../../../api/schemas/bookmarks';
import { toApiError } from '../../../api/schemas/problem';
import {
  buildLibraryViewKey,
  DEFAULT_LIBRARY_PAGE_SIZE,
  selectViewBookmarks,
  useLibraryStore,
  type LibraryScope,
} from '../../../stores/libraryStore';
import { useSyncStore } from '../../../stores/syncStore';

function parseScope(raw: string | null): LibraryScope {
  if (raw === 'favorites' || raw === 'unassigned') return raw;
  return 'all';
}

function parseSort(raw: string | null): BookmarkSort {
  if (raw === 'created' || raw === 'title') return raw;
  return 'updated';
}

function buildListQuery(scope: LibraryScope, sort: BookmarkSort, page: number): BookmarkListQuery {
  return {
    page,
    pageSize: DEFAULT_LIBRARY_PAGE_SIZE,
    sort,
    trashed: false,
    ...(scope === 'favorites' ? { favorite: true } : {}),
    ...(scope === 'unassigned' ? { unassignedOnly: true } : {}),
  };
}

export function useLibraryView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = parseScope(searchParams.get('view'));
  const sort = parseSort(searchParams.get('sort'));
  const viewKey = buildLibraryViewKey(scope, sort);

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

  const items = selectViewBookmarks(
    {
      views: viewState ? { [viewKey]: viewState } : {},
      bookmarksById,
    } as Parameters<typeof selectViewBookmarks>[0],
    viewKey,
  );

  const fetchPage = useCallback(
    async (page: number, append: boolean) => {
      setViewLoading(viewKey, true, append);
      try {
        const res = await bookmarksApi.list(buildListQuery(scope, sort, page));
        hydrateView(viewKey, res, append);
      } catch (err) {
        const apiErr = toApiError(err);
        setViewError(viewKey, apiErr.detail);
      }
    },
    [hydrateView, scope, setViewError, setViewLoading, sort, viewKey],
  );

  useEffect(() => {
    setActiveViewKey(viewKey);
  }, [setActiveViewKey, viewKey]);

  useEffect(() => {
    if (viewState || isBootstrapping) {
      return;
    }
    void fetchPage(1, false);
  }, [fetchPage, isBootstrapping, viewState]);

  const setScope = (nextScope: LibraryScope) => {
    const next = new URLSearchParams(searchParams);
    if (nextScope === 'all') {
      next.delete('view');
    } else {
      next.set('view', nextScope);
    }
    setSearchParams(next);
  };

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
    void fetchPage(1, false);
  };

  return {
    scope,
    sort,
    viewKey,
    layoutMode,
    setLayoutMode,
    setScope,
    setSort,
    items,
    totalCount: viewState?.totalCount ?? items.length,
    hasMore: viewState?.hasMore ?? false,
    loading: (viewState?.loading ?? (!viewState && isBootstrapping)) && items.length === 0,
    loadingMore: viewState?.loadingMore ?? false,
    error: viewState?.error ?? null,
    selectedBookmarkIds,
    toggleBookmarkSelection,
    loadMore,
    retry,
  };
}
