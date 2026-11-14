import { useCallback, useEffect, useRef, useState } from 'react';
import { bookmarksApi } from '../../../api/endpoints/bookmarks';
import { healthApi } from '../../../api/endpoints/health';
import { settingsApi } from '../../../api/endpoints/settings';
import { tagsApi } from '../../../api/endpoints/tags';
import type { Bookmark } from '../../../api/schemas/bookmarks';
import type { DuplicateGroup, ResolveDuplicatesResponse } from '../../../api/schemas/health';
import { toApiError } from '../../../api/schemas/problem';
import type { BrokenLinkCheckMode } from '../../../api/schemas/settings';
import { syncEngine } from '../../../api/sync-engine';
import { reindexBookmarkAction } from '../../../shared/actions/bookmarkActions';
import { refreshCollectionsTreeAction } from '../../../shared/actions/collectionActions';
import { useAuthStore } from '../../../stores/authStore';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useSyncStore } from '../../../stores/syncStore';
import { useUiStore } from '../../../stores/uiStore';
import { HEALTH_PAGE_STRINGS } from '../strings';

export function useHealthPage() {
  const userRole = useAuthStore((s) => s.user?.role);
  const isBootstrapping = useSyncStore((s) => s.isBootstrapping);
  const syncCursor = useSyncStore((s) => s.cursor);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const lastSyncError = useSyncStore((s) => s.lastError);

  const upsertBookmark = useLibraryStore((s) => s.upsertBookmark);
  const markBookmarksDeletedState = useLibraryStore((s) => s.markBookmarksDeletedState);

  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [brokenBookmarks, setBrokenBookmarks] = useState<Bookmark[]>([]);
  const [checkMode, setCheckMode] = useState<BrokenLinkCheckMode>('default');
  const [modeFromSettings, setModeFromSettings] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvingUrl, setResolvingUrl] = useState<string | null>(null);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const [resolvedBanner, setResolvedBanner] = useState<string | null>(null);

  const hasLoadedOnceRef = useRef(false);
  const lastSyncCursorRef = useRef(syncCursor);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dupRes, brokenRes] = await Promise.all([
        healthApi.findDuplicates(),
        bookmarksApi.list({ broken: true, page: 1, pageSize: 100 }),
      ]);
      setDuplicateGroups(dupRes.groups);
      setBrokenBookmarks(brokenRes.items);
      for (const bm of brokenRes.items) {
        upsertBookmark(bm);
      }
      hasLoadedOnceRef.current = true;
    } catch (err) {
      setError(toApiError(err).detail || 'Failed to load library health data.');
    } finally {
      setLoading(false);
    }
  }, [upsertBookmark]);

  useEffect(() => {
    if (isBootstrapping) return;
    if (
      !hasLoadedOnceRef.current &&
      syncCursor === '0' &&
      lastSyncedAt === null &&
      lastSyncError === null
    ) {
      return;
    }
    if (!hasLoadedOnceRef.current) {
      lastSyncCursorRef.current = syncCursor;
      void fetchAll();
      return;
    }
    if (syncCursor !== lastSyncCursorRef.current) {
      lastSyncCursorRef.current = syncCursor;
      void fetchAll();
    }
  }, [fetchAll, isBootstrapping, lastSyncError, lastSyncedAt, syncCursor]);

  useEffect(() => {
    if (isBootstrapping || userRole !== 'admin') {
      return;
    }
    let cancelled = false;
    void settingsApi
      .get()
      .then((settings) => {
        if (!cancelled) {
          setCheckMode(settings.brokenLinkCheckMode);
          setModeFromSettings(true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isBootstrapping, userRole]);

  const resolveGroup = async (
    group: DuplicateGroup,
    keepId: string,
    trashIds: string[],
  ): Promise<ResolveDuplicatesResponse | null> => {
    setResolvingUrl(group.normalizedUrl);
    setError(null);
    try {
      const response = await healthApi.resolveDuplicates({ keepId, trashIds });
      upsertBookmark(response.kept);
      markBookmarksDeletedState(response.trashedIds, new Date().toISOString());

      setDuplicateGroups((prev) =>
        prev.filter((item) => item.normalizedUrl !== group.normalizedUrl),
      );
      const keptTitle = response.kept.title ?? response.kept.url ?? response.kept.id;
      const summary = `${HEALTH_PAGE_STRINGS.resolvedBannerPrefix} "${keptTitle}" ${HEALTH_PAGE_STRINGS.resolvedBannerMiddle} ${response.trashedIds.length} ${HEALTH_PAGE_STRINGS.resolvedBannerSuffix}`;
      setResolvedBanner(summary);
      useUiStore.getState().enqueueSnackbar({
        message: summary,
        severity: 'success',
      });

      if (syncEngine.isRunning()) {
        void syncEngine.pullNow().catch(() => undefined);
      }
      void Promise.allSettled([
        bookmarksApi.stats().then((stats) => useLibraryStore.getState().hydrateStats(stats)),
        refreshCollectionsTreeAction(),
        tagsApi.list().then((tags) => useLibraryStore.getState().hydrateTags(tags)),
      ]);
      return response;
    } catch (err) {
      const detail = toApiError(err).detail || 'Failed to resolve duplicates.';
      setError(detail);
      useUiStore.getState().enqueueSnackbar({
        message: detail,
        severity: 'error',
      });
      return null;
    } finally {
      setResolvingUrl(null);
    }
  };

  const recheckBrokenBookmark = async (bookmarkId: string) => {
    setRecheckingId(bookmarkId);
    try {
      await reindexBookmarkAction(bookmarkId);
      setBrokenBookmarks((prev) =>
        prev.map((item) => (item.id === bookmarkId ? { ...item, cacheStatus: 'pending' } : item)),
      );
    } finally {
      setRecheckingId(null);
    }
  };

  return {
    duplicateGroups,
    brokenBookmarks,
    checkMode,
    modeFromSettings,
    loading,
    error,
    resolvingUrl,
    recheckingId,
    resolvedBanner,
    dismissResolvedBanner: () => setResolvedBanner(null),
    refresh: () => void fetchAll(),
    resolveGroup,
    recheckBrokenBookmark,
  };
}
