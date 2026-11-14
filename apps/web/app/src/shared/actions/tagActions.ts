import { tagsApi } from '../../api/endpoints/tags';
import type { TagSummary, TagUsage } from '../../api/schemas/bookmarks';
import { toApiError } from '../../api/schemas/problem';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import { SHARED_TAG_STRINGS } from '../strings';

export async function refreshTagsAction(): Promise<TagUsage[]> {
  try {
    const tags = await tagsApi.list();
    useLibraryStore.getState().hydrateTags(tags);
    return tags;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not load tags.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function renameTagAction(currentName: string, nextName: string): Promise<TagSummary> {
  try {
    const surviving = await tagsApi.rename(currentName, nextName);
    useLibraryStore.getState().renameOrMergeTagInLibrary(currentName, surviving);
    const refreshed = await tagsApi.list().catch(() => null);
    if (refreshed) {
      useLibraryStore.getState().hydrateTags(refreshed);
    }
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_TAG_STRINGS.toastTagRenamed,
      severity: 'success',
    });
    return surviving;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not rename tag.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function deleteTagAction(name: string): Promise<void> {
  try {
    await tagsApi.remove(name);
    useLibraryStore.getState().removeTagFromLibrary(name);
    const refreshed = await tagsApi.list().catch(() => null);
    if (refreshed) {
      useLibraryStore.getState().hydrateTags(refreshed);
    }
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_TAG_STRINGS.toastTagDeleted,
      severity: 'info',
    });
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not delete tag.',
      severity: 'error',
    });
    throw apiErr;
  }
}
