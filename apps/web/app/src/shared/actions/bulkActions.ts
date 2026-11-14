import { bookmarksApi } from '../../api/endpoints/bookmarks';
import { tagsApi } from '../../api/endpoints/tags';
import type {
  BulkBookmarksRequest,
  BulkBookmarksResponse,
  TagSummary,
} from '../../api/schemas/bookmarks';
import { toApiError } from '../../api/schemas/problem';
import { syncEngine } from '../../api/sync-engine';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import { SHARED_BULK_STRINGS } from '../strings';
import { refreshCollectionsTreeAction } from './collectionActions';

export const MAX_BULK_BOOKMARK_IDS = 500;

export function formatBulkSummaryMessage(response: BulkBookmarksResponse): string {
  const unit =
    response.affected === 1
      ? SHARED_BULK_STRINGS.bookmarkSingular
      : SHARED_BULK_STRINGS.bookmarkPlural;

  switch (response.action) {
    case 'move':
      return `${SHARED_BULK_STRINGS.summaryMove} ${response.affected} ${unit}.`;
    case 'addTags':
      return `${SHARED_BULK_STRINGS.summaryAddTags} ${response.affected} ${unit}.`;
    case 'removeTags':
      return `${SHARED_BULK_STRINGS.summaryRemoveTags} ${response.affected} ${unit}.`;
    case 'trash':
      return `${SHARED_BULK_STRINGS.summaryTrash} ${response.affected} ${unit}.`;
    case 'restore':
      return `${SHARED_BULK_STRINGS.summaryRestore} ${response.affected} ${unit}.`;
    case 'delete':
      return `${SHARED_BULK_STRINGS.summaryDelete} ${response.affected} ${unit}.`;
  }
}

function applyLocalTagMutations(
  ids: string[],
  action: 'addTags' | 'removeTags',
  tagNames: string[],
): void {
  const store = useLibraryStore.getState();
  const normalizedTargetLowers = new Set(
    tagNames.map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  if (normalizedTargetLowers.size === 0) return;

  for (const id of ids) {
    const bookmark = store.bookmarksById[id];
    if (!bookmark) continue;

    if (action === 'addTags') {
      const existingLowers = new Set(bookmark.tags.map((t) => t.name.toLowerCase()));
      const additions: TagSummary[] = [];
      for (const raw of tagNames) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const lower = trimmed.toLowerCase();
        if (existingLowers.has(lower)) continue;
        existingLowers.add(lower);
        const knownTag = Object.values(store.tagsById).find(
          (t) => t.name.toLowerCase() === lower,
        );
        additions.push({
          id: knownTag?.id ?? `local-${lower}`,
          name: knownTag?.name ?? trimmed,
        });
      }
      if (additions.length > 0) {
        store.upsertBookmark({
          ...bookmark,
          tags: [...bookmark.tags, ...additions],
        });
      }
    } else {
      const filtered = bookmark.tags.filter(
        (t) => !normalizedTargetLowers.has(t.name.toLowerCase()),
      );
      if (filtered.length !== bookmark.tags.length) {
        store.upsertBookmark({
          ...bookmark,
          tags: filtered,
        });
      }
    }
  }
}

export async function executeBulkBookmarksAction(
  input: BulkBookmarksRequest,
): Promise<BulkBookmarksResponse> {
  try {
    const response = await bookmarksApi.bulk(input);
    const store = useLibraryStore.getState();

    if (input.action === 'trash') {
      store.markBookmarksDeletedState(response.ids, new Date().toISOString());
    } else if (input.action === 'restore') {
      store.markBookmarksDeletedState(response.ids, null);
    } else if (input.action === 'delete') {
      store.removeBookmarks(response.ids);
    } else if (
      (input.action === 'addTags' || input.action === 'removeTags') &&
      input.tags &&
      input.tags.length > 0
    ) {
      applyLocalTagMutations(response.ids, input.action, input.tags);
    }

    store.clearSelection();

    if (syncEngine.isRunning()) {
      void syncEngine.pullNow().catch(() => undefined);
    }

    void Promise.allSettled([
      bookmarksApi.stats().then((stats) => useLibraryStore.getState().hydrateStats(stats)),
      refreshCollectionsTreeAction(),
      tagsApi.list().then((tags) => useLibraryStore.getState().hydrateTags(tags)),
    ]);

    useUiStore.getState().enqueueSnackbar({
      message: formatBulkSummaryMessage(response),
      severity: response.action === 'trash' || response.action === 'delete' ? 'info' : 'success',
    });

    return response;
  } catch (err) {
    const apiErr = toApiError(err);
    if (apiErr.status !== 429 && apiErr.status !== 409) {
      useUiStore.getState().enqueueSnackbar({
        message: apiErr.detail || 'Bulk operation failed.',
        severity: 'error',
      });
    }
    throw apiErr;
  }
}
