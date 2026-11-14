import { bookmarksApi } from '../../api/endpoints/bookmarks';
import { collectionsApi } from '../../api/endpoints/collections';
import { tagsApi } from '../../api/endpoints/tags';
import type {
  Bookmark,
  CreateBookmarkQuery,
  CreateBookmarkRequest,
  UpdateBookmarkRequest,
} from '../../api/schemas/bookmarks';
import { toApiError } from '../../api/schemas/problem';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import { SHARED_QUICK_ADD_STRINGS, SHARED_TAG_STRINGS } from '../strings';

export interface CreateBookmarkActionInput {
  body: CreateBookmarkRequest;
  query?: CreateBookmarkQuery;
  tags?: string[];
}

export async function createBookmarkAction(input: CreateBookmarkActionInput): Promise<Bookmark> {
  try {
    let created = await bookmarksApi.create(input.body, input.query);
    if (input.tags && input.tags.length > 0) {
      created = await bookmarksApi.replaceTags(created.id, input.tags);
    }

    const store = useLibraryStore.getState();
    store.upsertBookmark(created);

    const collectionParam = input.query?.collection?.trim();
    if (collectionParam) {
      const matchedCollection = Object.values(store.collectionsById).find(
        (col) =>
          col.id === collectionParam ||
          col.title.trim().toLowerCase() === collectionParam.toLowerCase(),
      );
      if (matchedCollection) {
        store.addBookmarkToCollectionViews(matchedCollection.id, created);
      }
    }

    void Promise.all([
      bookmarksApi
        .stats()
        .then((stats) => useLibraryStore.getState().hydrateStats(stats))
        .catch(() => undefined),
      collectionsApi
        .list()
        .then((res) => useLibraryStore.getState().hydrateCollections(res.items))
        .catch(() => undefined),
      tagsApi
        .list()
        .then((tags) => useLibraryStore.getState().hydrateTags(tags))
        .catch(() => undefined),
    ]);

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
