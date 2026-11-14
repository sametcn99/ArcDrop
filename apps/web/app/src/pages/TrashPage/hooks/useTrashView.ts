import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bookmarksApi } from '../../../api/endpoints/bookmarks';
import { settingsApi } from '../../../api/endpoints/settings';
import type { Bookmark } from '../../../api/schemas/bookmarks';
import { toApiError } from '../../../api/schemas/problem';
import { restoreBookmarkAction } from '../../../shared/actions/bookmarkActions';
import {
  executeBulkBookmarksAction,
  MAX_BULK_BOOKMARK_IDS,
} from '../../../shared/actions/bulkActions';
import { useAuthStore } from '../../../stores/authStore';
import { DEFAULT_LIBRARY_PAGE_SIZE, useLibraryStore } from '../../../stores/libraryStore';
import { useSyncStore } from '../../../stores/syncStore';

const DEFAULT_TRASH_RETENTION_DAYS = 30;

export function useTrashView() {
  const userRole = useAuthStore((s) => s.user?.role);
  const isBootstrapping = useSyncStore((s) => s.isBootstrapping);
  const syncCursor = useSyncStore((s) => s.cursor);

  const bookmarksById = useLibraryStore((s) => s.bookmarksById);
  const selectedBookmarkIds = useLibraryStore((s) => s.selectedBookmarkIds);
  const toggleBookmarkSelection = useLibraryStore((s) => s.toggleBookmarkSelection);
  const upsertBookmark = useLibraryStore((s) => s.upsertBookmark);

  const [trashedIds, setTrashedIds] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [purgingAll, setPurgingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState<number>(DEFAULT_TRASH_RETENTION_DAYS);
  const [retentionFromSettings, setRetentionFromSettings] = useState(false);

  const hasFetchedOnceRef = useRef(false);
  const lastSyncedCursorRef = useRef(syncCursor);

  const fetchPage = useCallback(
    async (targetPage: number, append: boolean) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await bookmarksApi.list({
          trashed: true,
          page: targetPage,
          pageSize: DEFAULT_LIBRARY_PAGE_SIZE,
        });
        for (const item of res.items) {
          upsertBookmark(item);
        }
        const incomingIds = res.items.map((item) => item.id);
        setTrashedIds((prev) =>
          append ? [...prev, ...incomingIds.filter((id) => !prev.includes(id))] : incomingIds,
        );
        setTotalCount(res.totalCount);
        setPage(res.page);
        setHasMore(
          append ? targetPage * res.pageSize < res.totalCount : incomingIds.length < res.totalCount,
        );
        hasFetchedOnceRef.current = true;
      } catch (err) {
        setError(toApiError(err).detail || 'Failed to load trash.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [upsertBookmark],
  );

  useEffect(() => {
    if (isBootstrapping) return;
    if (!hasFetchedOnceRef.current) {
      lastSyncedCursorRef.current = syncCursor;
      void fetchPage(1, false);
      return;
    }
    if (syncCursor !== lastSyncedCursorRef.current) {
      lastSyncedCursorRef.current = syncCursor;
      void fetchPage(1, false);
    }
  }, [fetchPage, isBootstrapping, syncCursor]);

  useEffect(() => {
    if (isBootstrapping || userRole !== 'admin') {
      return;
    }
    let cancelled = false;
    void settingsApi
      .get()
      .then((settings) => {
        if (!cancelled) {
          setRetentionDays(settings.trashRetentionDays);
          setRetentionFromSettings(true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isBootstrapping, userRole]);

  const items = useMemo<Bookmark[]>(() => {
    const result: Bookmark[] = [];
    for (const id of trashedIds) {
      const bm = bookmarksById[id];
      if (bm && bm.deletedAt !== null) {
        result.push(bm);
      }
    }
    return result;
  }, [bookmarksById, trashedIds]);

  const effectiveTotalCount = useMemo(() => {
    if (hasMore) {
      return Math.max(items.length, totalCount - (trashedIds.length - items.length));
    }
    return items.length;
  }, [hasMore, items.length, totalCount, trashedIds.length]);

  const loadMore = async () => {
    if (!hasMore || loadingMore || loading) return;
    await fetchPage(page + 1, true);
  };

  const retry = () => {
    void fetchPage(1, false);
  };

  const restoreItem = async (id: string) => {
    setBusyItemId(id);
    setError(null);
    try {
      await restoreBookmarkAction(id);
      setTrashedIds((prev) => prev.filter((itemId) => itemId !== id));
      setTotalCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setError(toApiError(err).detail || 'Failed to restore bookmark.');
    } finally {
      setBusyItemId(null);
    }
  };

  const purgeItem = async (id: string) => {
    setBusyItemId(id);
    setError(null);
    try {
      await executeBulkBookmarksAction({ action: 'delete', ids: [id] });
      setTrashedIds((prev) => prev.filter((itemId) => itemId !== id));
      setTotalCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setError(toApiError(err).detail || 'Failed to purge bookmark.');
    } finally {
      setBusyItemId(null);
    }
  };

  const purgeAll = async () => {
    setPurgingAll(true);
    setError(null);
    try {
      const allIds = new Set<string>(items.map((item) => item.id));
      if (hasMore) {
        let nextPage = page + 1;
        let keepFetching = true;
        while (keepFetching) {
          const res = await bookmarksApi.list({
            trashed: true,
            page: nextPage,
            pageSize: MAX_BULK_BOOKMARK_IDS,
          });
          for (const item of res.items) {
            allIds.add(item.id);
          }
          if (res.items.length === 0 || allIds.size >= res.totalCount) {
            keepFetching = false;
          } else {
            nextPage += 1;
          }
        }
      }

      const idList = Array.from(allIds);
      for (let i = 0; i < idList.length; i += MAX_BULK_BOOKMARK_IDS) {
        const chunk = idList.slice(i, i + MAX_BULK_BOOKMARK_IDS);
        await executeBulkBookmarksAction({ action: 'delete', ids: chunk });
      }
      setTrashedIds([]);
      setTotalCount(0);
      setHasMore(false);
    } catch (err) {
      setError(toApiError(err).detail || 'Failed to purge all trashed bookmarks.');
      void fetchPage(1, false);
    } finally {
      setPurgingAll(false);
    }
  };

  return {
    items,
    totalCount: effectiveTotalCount,
    hasMore,
    loading,
    loadingMore,
    busyItemId,
    purgingAll,
    error,
    retentionDays,
    retentionFromSettings,
    selectedBookmarkIds,
    toggleBookmarkSelection,
    loadMore,
    retry,
    restoreItem,
    purgeItem,
    purgeAll,
    refresh: () => void fetchPage(1, false),
  };
}
