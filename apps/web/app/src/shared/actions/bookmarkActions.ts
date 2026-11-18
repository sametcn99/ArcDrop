import { bookmarksApi } from '../../api/endpoints/bookmarks';
import { tagsApi } from '../../api/endpoints/tags';
import type {
  Bookmark,
  CreateBookmarkQuery,
  CreateBookmarkRequest,
  ReindexBookmarkResponse,
  UpdateBookmarkRequest,
  UploadBookmarkFileInput,
} from '../../api/schemas/bookmarks';
import { toApiError } from '../../api/schemas/problem';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import {
  SHARED_BOOKMARK_STRINGS,
  SHARED_QUICK_ADD_STRINGS,
  SHARED_TAG_STRINGS,
  SHARED_UPLOAD_STRINGS,
} from '../strings';
import { triggerBlobDownload } from '../utils/blobDownload';

export interface CreateBookmarkActionInput {
  body: CreateBookmarkRequest;
  query?: CreateBookmarkQuery;
  tags?: string[];
}

/**
 * Aggregate refresh after a local create/upload. The old behavior fired three
 * fire-and-forget GETs (stats + collections + tags) after every mutation even
 * though the sync engine delivers the same change moments later; we now bump
 * the client-side aggregates directly. `existedBefore` guards the race where
 * the WS change (which bumps the same aggregates in applySyncChanges) lands
 * before the POST response — exactly one side counts.
 */
function bumpAggregatesForCreatedBookmark(created: Bookmark, hasCollection: boolean): void {
  const store = useLibraryStore.getState();
  if (!useLibraryStore.getState().bookmarksById[created.id]) {
    store.upsertBookmark(created);
    store.bumpStatsForCreatedBookmark(created, { hasCollection });
    store.bumpTagCounts(created.tags, 1);
  } else {
    store.upsertBookmark(created);
  }
}

export async function createBookmarkAction(input: CreateBookmarkActionInput): Promise<Bookmark> {
  try {
    let created = await bookmarksApi.create(input.body, input.query);
    if (input.tags && input.tags.length > 0) {
      created = await bookmarksApi.replaceTags(created.id, input.tags);
    }

    const store = useLibraryStore.getState();

    const collectionParam = input.query?.collection?.trim();
    let matchedCollectionId: string | null = null;
    if (collectionParam) {
      const matchedCollection = Object.values(store.collectionsById).find(
        (col) =>
          col.id === collectionParam ||
          col.title.trim().toLowerCase() === collectionParam.toLowerCase(),
      );
      matchedCollectionId = matchedCollection?.id ?? null;
    }

    bumpAggregatesForCreatedBookmark(created, matchedCollectionId !== null);

    if (matchedCollectionId) {
      store.addBookmarkToCollectionViews(matchedCollectionId, created);
      store.adjustCollectionBookmarkCount(matchedCollectionId, 1);
    }

    useUiStore.getState().enqueueSnackbar({
      message: SHARED_QUICK_ADD_STRINGS.toastCreated,
      severity: 'success',
    });
    return created;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not create bookmark.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function uploadBookmarkFileAction(input: UploadBookmarkFileInput): Promise<Bookmark> {
  try {
    const created = await bookmarksApi.uploadFile(input);

    const store = useLibraryStore.getState();
    bumpAggregatesForCreatedBookmark(created, (input.collectionIds?.length ?? 0) > 0);

    if (input.collectionIds && input.collectionIds.length > 0) {
      for (const collectionId of input.collectionIds) {
        store.addBookmarkToCollectionViews(collectionId, created);
        store.adjustCollectionBookmarkCount(collectionId, 1);
      }
    }

    useUiStore.getState().enqueueSnackbar({
      message: SHARED_UPLOAD_STRINGS.toastUploaded,
      severity: 'success',
    });
    return created;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not upload file.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function downloadBookmarkFileAction(bookmark: Bookmark): Promise<string> {
  try {
    const response = await bookmarksApi.getFileBlob(bookmark.id, { download: true });
    const resolvedFilename = response.filename ?? bookmark.fileName ?? 'download';

    triggerBlobDownload(response.blob, resolvedFilename);

    useUiStore.getState().enqueueSnackbar({
      message: `${SHARED_BOOKMARK_STRINGS.toastFileDownloaded} (${resolvedFilename})`,
      severity: 'success',
    });
    return resolvedFilename;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not download file.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function reindexBookmarkAction(bookmarkId: string): Promise<ReindexBookmarkResponse> {
  try {
    const res = await bookmarksApi.reindex(bookmarkId);
    const current = useLibraryStore.getState().bookmarksById[bookmarkId];
    if (current) {
      useLibraryStore.getState().upsertBookmark({
        ...current,
        cacheStatus: 'pending',
      });
    }
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_BOOKMARK_STRINGS.toastReindexScheduled,
      severity: 'info',
    });
    return res;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not schedule reindex.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function replaceBookmarkTagsAction(
  bookmarkId: string,
  tags: string[],
): Promise<Bookmark> {
  try {
    const updated = await bookmarksApi.replaceTags(bookmarkId, tags);
    useLibraryStore.getState().upsertBookmark(updated);
    void tagsApi
      .list()
      .then((list) => useLibraryStore.getState().hydrateTags(list))
      .catch(() => undefined);
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_TAG_STRINGS.toastTagsUpdated,
      severity: 'success',
    });
    return updated;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not update tags.',
      severity: 'error',
    });
    throw apiErr;
  }
}

/** Assigns a cover by URL — the server downloads and stores it (plan E8). */
export async function setBookmarkCoverAction(
  bookmarkId: string,
  imageUrl: string,
): Promise<Bookmark> {
  try {
    const updated = await bookmarksApi.setCover(bookmarkId, imageUrl);
    useLibraryStore.getState().upsertBookmark(updated);
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_BOOKMARK_STRINGS.toastCoverAssigned,
      severity: 'success',
    });
    return updated;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not assign the cover.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function toggleBookmarkFavoriteAction(bookmark: Bookmark): Promise<Bookmark> {
  const nextFavorite = !bookmark.favorite;
  const libraryStore = useLibraryStore.getState();
  libraryStore.beginOptimisticBookmark(bookmark.id, { favorite: nextFavorite });

  try {
    const updated = await bookmarksApi.update(bookmark.id, { favorite: nextFavorite });
    useLibraryStore.getState().commitOptimisticBookmark(bookmark.id, updated);
    return updated;
  } catch (err) {
    useLibraryStore.getState().rollbackOptimisticBookmark(bookmark.id);
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not update favorite status.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function updateBookmarkDetailsAction(
  bookmarkId: string,
  patch: UpdateBookmarkRequest,
): Promise<Bookmark> {
  const libraryStore = useLibraryStore.getState();
  libraryStore.beginOptimisticBookmark(bookmarkId, {
    title: patch.title !== undefined ? patch.title : undefined,
    excerpt: patch.excerpt !== undefined ? patch.excerpt : undefined,
    note: patch.note !== undefined ? patch.note : undefined,
    url: patch.url !== undefined ? patch.url : undefined,
    favorite: patch.favorite !== undefined ? patch.favorite : undefined,
    reminderAt: patch.reminderAt !== undefined ? patch.reminderAt : undefined,
  });

  try {
    const updated = await bookmarksApi.update(bookmarkId, patch);
    useLibraryStore.getState().commitOptimisticBookmark(bookmarkId, updated);
    useUiStore.getState().enqueueSnackbar({
      message: 'Bookmark updated.',
      severity: 'success',
    });
    return updated;
  } catch (err) {
    useLibraryStore.getState().rollbackOptimisticBookmark(bookmarkId);
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not save bookmark changes.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function trashBookmarkAction(bookmark: Bookmark): Promise<void> {
  const libraryStore = useLibraryStore.getState();
  const trashedAt = new Date().toISOString();
  libraryStore.beginOptimisticBookmark(bookmark.id, { deletedAt: trashedAt });

  try {
    await bookmarksApi.trash(bookmark.id);
    useLibraryStore.getState().commitOptimisticBookmark(bookmark.id, {
      ...bookmark,
      deletedAt: trashedAt,
      updatedAt: trashedAt,
    });
    useUiStore.getState().enqueueSnackbar({
      message: 'Bookmark moved to trash.',
      severity: 'info',
    });
  } catch (err) {
    useLibraryStore.getState().rollbackOptimisticBookmark(bookmark.id);
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not move bookmark to trash.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function restoreBookmarkAction(bookmarkId: string): Promise<Bookmark> {
  const libraryStore = useLibraryStore.getState();
  libraryStore.beginOptimisticBookmark(bookmarkId, { deletedAt: null });

  try {
    const restored = await bookmarksApi.restore(bookmarkId);
    useLibraryStore.getState().commitOptimisticBookmark(bookmarkId, restored);
    useUiStore.getState().enqueueSnackbar({
      message: 'Bookmark restored to library.',
      severity: 'success',
    });
    return restored;
  } catch (err) {
    useLibraryStore.getState().rollbackOptimisticBookmark(bookmarkId);
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not restore bookmark.',
      severity: 'error',
    });
    throw apiErr;
  }
}
