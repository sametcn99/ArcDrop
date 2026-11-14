import { bookmarksApi } from '../../api/endpoints/bookmarks';
import type { Bookmark, UpdateBookmarkRequest } from '../../api/schemas/bookmarks';
import { toApiError } from '../../api/schemas/problem';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';

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
