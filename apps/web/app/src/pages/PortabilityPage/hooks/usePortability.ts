import { useEffect, useMemo, useState } from 'react';
import { bookmarksApi } from '../../../api/endpoints/bookmarks';
import { portabilityApi } from '../../../api/endpoints/portability';
import { tagsApi } from '../../../api/endpoints/tags';
import type { Bookmark } from '../../../api/schemas/bookmarks';
import type {
  ExportDataRequest,
  HighlightsExportFormat,
  ImportSummary,
} from '../../../api/schemas/portability';
import { toApiError } from '../../../api/schemas/problem';
import { syncEngine } from '../../../api/sync-engine';
import { platform } from '../../../platform';
import { refreshCollectionsTreeAction } from '../../../shared/actions/collectionActions';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useSyncStore } from '../../../stores/syncStore';
import { useUiStore } from '../../../stores/uiStore';
import { PORTABILITY_PAGE_STRINGS } from '../strings';

export function usePortability() {
  const isBootstrapping = useSyncStore((s) => s.isBootstrapping);
  const bookmarksById = useLibraryStore((s) => s.bookmarksById);
  const upsertBookmark = useLibraryStore((s) => s.upsertBookmark);

  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusyConflict, setImportBusyConflict] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [exportingHighlights, setExportingHighlights] = useState(false);
  const [highlightsError, setHighlightsError] = useState<string | null>(null);

  const activeBookmarks = useMemo<Bookmark[]>(
    () =>
      Object.values(bookmarksById)
        .filter((bm) => bm.deletedAt === null)
        .sort((a, b) => (a.title ?? a.url ?? a.id).localeCompare(b.title ?? b.url ?? b.id)),
    [bookmarksById],
  );

  // If user navigates directly to /portability without visiting LibraryPage first, seed bookmark choices.
  useEffect(() => {
    if (isBootstrapping || activeBookmarks.length > 0) {
      return;
    }
    let cancelled = false;
    void bookmarksApi
      .list({ page: 1, pageSize: 50 })
      .then((res) => {
        if (cancelled) return;
        for (const item of res.items) {
          upsertBookmark(item);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeBookmarks.length, isBootstrapping, upsertBookmark]);

  const runImport = async (file: File): Promise<ImportSummary | null> => {
    setImporting(true);
    setImportError(null);
    setImportBusyConflict(null);
    try {
      const summary = await portabilityApi.importData(file);
      setImportSummary(summary);

      if (syncEngine.isRunning()) {
        void syncEngine.pullNow().catch(() => undefined);
      }
      void Promise.allSettled([
        bookmarksApi.stats().then((stats) => useLibraryStore.getState().hydrateStats(stats)),
        refreshCollectionsTreeAction(),
        tagsApi.list().then((tags) => useLibraryStore.getState().hydrateTags(tags)),
      ]);
      return summary;
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr.status === 409) {
        setImportBusyConflict(apiErr.detail || PORTABILITY_PAGE_STRINGS.importBusyFallback);
      } else {
        setImportError(apiErr.detail || 'Import failed.');
      }
      return null;
    } finally {
      setImporting(false);
    }
  };

  const runExport = async (input: ExportDataRequest): Promise<boolean> => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await portabilityApi.exportData(input);
      const ext = input.includeFiles ? 'zip' : input.format;
      const filename = res.filename ?? `arcdrop-export.${ext}`;
      await platform.saveBlob(res.blob, filename);
      useUiStore.getState().enqueueSnackbar({
        message: `${PORTABILITY_PAGE_STRINGS.exportSuccessToastPrefix} ${filename}`,
        severity: 'success',
      });
      return true;
    } catch (err) {
      const apiErr = toApiError(err);
      setExportError(apiErr.detail || 'Export failed.');
      return false;
    } finally {
      setExporting(false);
    }
  };

  const runHighlightsExport = async (
    bookmarkId: string,
    format: HighlightsExportFormat,
  ): Promise<boolean> => {
    setExportingHighlights(true);
    setHighlightsError(null);
    try {
      const res = await portabilityApi.exportBookmarkHighlights(bookmarkId, format);
      const filename = res.filename ?? `highlights-${bookmarkId}.${format}`;
      await platform.saveBlob(res.blob, filename);
      useUiStore.getState().enqueueSnackbar({
        message: `${PORTABILITY_PAGE_STRINGS.highlightsToastPrefix} ${filename}`,
        severity: 'success',
      });
      return true;
    } catch (err) {
      const apiErr = toApiError(err);
      setHighlightsError(apiErr.detail || 'Highlights export failed.');
      return false;
    } finally {
      setExportingHighlights(false);
    }
  };

  return {
    activeBookmarks,
    importing,
    importSummary,
    importError,
    importBusyConflict,
    clearImportFeedback: () => {
      setImportSummary(null);
      setImportError(null);
      setImportBusyConflict(null);
    },
    runImport,
    exporting,
    exportError,
    clearExportError: () => setExportError(null),
    runExport,
    exportingHighlights,
    highlightsError,
    runHighlightsExport,
  };
}
