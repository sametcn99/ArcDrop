import { bookmarksApi } from '../../api/endpoints/bookmarks';
import { collectionsApi } from '../../api/endpoints/collections';
import type { Bookmark } from '../../api/schemas/bookmarks';
import type {
  Collection,
  CollectionShareResponse,
  CreateCollectionRequest,
  MergeCollectionsResponse,
  UpdateCollectionRequest,
} from '../../api/schemas/collections';
import { ApiError, toApiError } from '../../api/schemas/problem';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import { SHARED_COLLECTION_STRINGS } from '../strings';
import { flattenCollectionNodes } from '../utils/collectionTree';

export async function refreshCollectionsTreeAction(): Promise<Collection[]> {
  const treeNodes = await collectionsApi.tree();
  const flat = flattenCollectionNodes(treeNodes);
  useLibraryStore.getState().hydrateCollections(flat);
  return flat;
}

export async function createCollectionAction(input: CreateCollectionRequest): Promise<Collection> {
  try {
    const created = await collectionsApi.create(input);
    const store = useLibraryStore.getState();
    store.upsertCollection(created);
    if (created.parentId) {
      store.setCollectionExpanded(created.parentId, true);
    }
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_COLLECTION_STRINGS.toastCreated,
      severity: 'success',
    });
    return created;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function updateCollectionAction(
  id: string,
  input: UpdateCollectionRequest,
): Promise<Collection> {
  try {
    const updated = await collectionsApi.update(id, input);
    const store = useLibraryStore.getState();
    store.upsertCollection(updated);
    if (updated.parentId) {
      store.setCollectionExpanded(updated.parentId, true);
    }
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_COLLECTION_STRINGS.toastUpdated,
      severity: 'success',
    });
    return updated;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function moveCollectionParentAction(
  collectionId: string,
  newParentId: string | null,
): Promise<Collection> {
  try {
    const updated = await collectionsApi.update(collectionId, { parentId: newParentId });
    const store = useLibraryStore.getState();
    store.upsertCollection(updated);
    if (newParentId) {
      store.setCollectionExpanded(newParentId, true);
    }
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_COLLECTION_STRINGS.toastMoved,
      severity: 'success',
    });
    return updated;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function reorderSiblingCollectionsAction(
  items: { id: string; order: number }[],
): Promise<void> {
  if (items.length === 0) return;
  const store = useLibraryStore.getState();
  const snapshot = store.applyCollectionOrder(items);

  try {
    await collectionsApi.reorder(items);
  } catch (err) {
    useLibraryStore.getState().restoreCollectionsSnapshot(snapshot);
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function deleteCollectionAction(
  id: string,
  options: { cascade?: 'trash' } = {},
): Promise<void> {
  try {
    await collectionsApi.delete(id, options);
    const store = useLibraryStore.getState();
    store.removeCollections([id]);
    // Refresh active tree/counts & stats so cascade-trashed children and bookmark counts converge immediately.
    await Promise.allSettled([
      refreshCollectionsTreeAction(),
      bookmarksApi.stats().then((stats) => useLibraryStore.getState().hydrateStats(stats)),
    ]);
    useUiStore.getState().enqueueSnackbar({
      message:
        options.cascade === 'trash'
          ? SHARED_COLLECTION_STRINGS.toastDeletedCascade
          : SHARED_COLLECTION_STRINGS.toastDeleted,
      severity: 'info',
    });
  } catch (err) {
    const apiErr = toApiError(err);
    // Let callers (e.g. Delete dialog) surface 409 blocked-with-children inline without noisy duplicate errors unless unexpected.
    if (!(apiErr instanceof ApiError && apiErr.status === 409 && !options.cascade)) {
      useUiStore.getState().enqueueSnackbar({
        message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
        severity: 'error',
      });
    }
    throw apiErr;
  }
}

export async function setCollectionShareAction(
  id: string,
  enabled: boolean,
): Promise<CollectionShareResponse> {
  try {
    const res = await collectionsApi.setShare(id, enabled);
    useLibraryStore.getState().setCollectionShareState(id, {
      enabled: res.enabled,
      shareToken: res.shareToken,
    });
    useUiStore.getState().enqueueSnackbar({
      message: res.enabled
        ? SHARED_COLLECTION_STRINGS.toastShareEnabled
        : SHARED_COLLECTION_STRINGS.toastShareDisabled,
      severity: res.enabled ? 'success' : 'info',
    });
    return res;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function mergeCollectionsAction(
  sourceIds: string[],
  targetId: string,
): Promise<MergeCollectionsResponse> {
  try {
    const result = await collectionsApi.merge({ sourceIds, targetId });
    const store = useLibraryStore.getState();
    store.upsertCollection(result.target);
    store.removeCollections(result.trashedIds);
    await Promise.allSettled([
      refreshCollectionsTreeAction(),
      bookmarksApi.stats().then((stats) => useLibraryStore.getState().hydrateStats(stats)),
    ]);
    return result;
  } catch (err) {
    const apiErr = toApiError(err);
    if (!(apiErr instanceof ApiError && apiErr.status === 409)) {
      useUiStore.getState().enqueueSnackbar({
        message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
        severity: 'error',
      });
    }
    throw apiErr;
  }
}

export async function addBookmarkToCollectionAction(
  bookmark: Bookmark,
  collectionId: string,
): Promise<void> {
  try {
    await bookmarksApi.bulk({
      action: 'move',
      mode: 'union',
      ids: [bookmark.id],
      collectionIds: [collectionId],
    });
    const store = useLibraryStore.getState();
    store.addBookmarkToCollectionViews(collectionId, bookmark);
    await Promise.allSettled([
      refreshCollectionsTreeAction(),
      bookmarksApi.stats().then((stats) => useLibraryStore.getState().hydrateStats(stats)),
    ]);
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_COLLECTION_STRINGS.toastBookmarkAdded,
      severity: 'success',
    });
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function replaceBookmarkCollectionsAction(
  bookmarkId: string,
  collectionIds: string[],
) {
  try {
    const res = await bookmarksApi.replaceCollections(bookmarkId, collectionIds);
    await Promise.allSettled([
      refreshCollectionsTreeAction(),
      bookmarksApi.stats().then((stats) => useLibraryStore.getState().hydrateStats(stats)),
    ]);
    return res;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function reorderCollectionBookmarksAction(
  collectionId: string,
  viewKey: string,
  orderedBookmarkIds: string[],
): Promise<void> {
  if (orderedBookmarkIds.length === 0) return;
  const store = useLibraryStore.getState();
  const previousIds = store.reorderViewIds(viewKey, orderedBookmarkIds);

  const items = orderedBookmarkIds.map((bookmarkId, index) => ({
    bookmarkId,
    order: index,
  }));

  try {
    await collectionsApi.reorderBookmarks(collectionId, items);
  } catch (err) {
    if (previousIds) {
      useLibraryStore.getState().reorderViewIds(viewKey, previousIds);
    }
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric,
      severity: 'error',
    });
    throw apiErr;
  }
}
