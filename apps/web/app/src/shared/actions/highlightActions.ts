import { highlightsApi } from '../../api/endpoints/highlights';
import type {
  CreateHighlightRequest,
  Highlight,
  UpdateHighlightRequest,
} from '../../api/schemas/bookmarks';
import { toApiError } from '../../api/schemas/problem';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';

export async function loadBookmarkHighlightsAction(bookmarkId: string): Promise<Highlight[]> {
  try {
    const res = await highlightsApi.listByBookmark(bookmarkId);
    useLibraryStore.getState().hydrateHighlights(bookmarkId, res.items);
    return res.items;
  } catch (err) {
    const apiErr = toApiError(err);
    throw apiErr;
  }
}

export async function createHighlightAction(
  bookmarkId: string,
  input: CreateHighlightRequest,
): Promise<Highlight> {
  try {
    const created = await highlightsApi.create(bookmarkId, input);
    useLibraryStore.getState().upsertHighlight(created);
    useUiStore.getState().enqueueSnackbar({
      message: 'Highlight added.',
      severity: 'success',
    });
    return created;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not add highlight.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function updateHighlightAction(
  highlightId: string,
  input: UpdateHighlightRequest,
): Promise<Highlight> {
  try {
    const updated = await highlightsApi.update(highlightId, input);
    useLibraryStore.getState().upsertHighlight(updated);
    useUiStore.getState().enqueueSnackbar({
      message: 'Highlight updated.',
      severity: 'success',
    });
    return updated;
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not update highlight.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function deleteHighlightAction(
  bookmarkId: string,
  highlightId: string,
): Promise<void> {
  try {
    await highlightsApi.remove(highlightId);
    useLibraryStore.getState().removeHighlight(bookmarkId, highlightId);
    useUiStore.getState().enqueueSnackbar({
      message: 'Highlight deleted.',
      severity: 'info',
    });
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not delete highlight.',
      severity: 'error',
    });
    throw apiErr;
  }
}
