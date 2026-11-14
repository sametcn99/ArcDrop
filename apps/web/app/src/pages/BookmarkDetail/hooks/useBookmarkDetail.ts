import { useCallback, useEffect, useMemo, useState } from 'react';
import { bookmarksApi } from '../../../api/endpoints/bookmarks';
import {
  updateBookmarkRequestSchema,
  type Bookmark,
  type BookmarkArchive,
  type CreateHighlightRequest,
  type UpdateBookmarkRequest,
  type UpdateHighlightRequest,
} from '../../../api/schemas/bookmarks';
import { toApiError } from '../../../api/schemas/problem';
import {
  downloadBookmarkFileAction,
  reindexBookmarkAction,
  replaceBookmarkTagsAction,
  restoreBookmarkAction,
  toggleBookmarkFavoriteAction,
  trashBookmarkAction,
  updateBookmarkDetailsAction,
} from '../../../shared/actions/bookmarkActions';
import {
  createHighlightAction,
  deleteHighlightAction,
  loadBookmarkHighlightsAction,
  updateHighlightAction,
} from '../../../shared/actions/highlightActions';
import { selectBookmarkHighlights, useLibraryStore } from '../../../stores/libraryStore';

export interface BookmarkFormValues {
  title: string;
  url: string;
  excerpt: string;
  note: string;
}

const EMPTY_FORM: BookmarkFormValues = {
  title: '',
  url: '',
  excerpt: '',
  note: '',
};

function toFormValues(bookmark: Bookmark): BookmarkFormValues {
  return {
    title: bookmark.title ?? '',
    url: bookmark.url ?? '',
    excerpt: bookmark.excerpt ?? '',
    note: bookmark.note ?? '',
  };
}

function normalizeNullableField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function useBookmarkDetail(bookmarkId: string | undefined) {
  const bookmark = useLibraryStore((s) => (bookmarkId ? s.bookmarksById[bookmarkId] : undefined));
  const upsertBookmark = useLibraryStore((s) => s.upsertBookmark);
  const highlightsMap = useLibraryStore((s) =>
    bookmarkId ? s.highlightsByBookmarkId[bookmarkId] : undefined,
  );
  const highlightsLoaded = useLibraryStore((s) =>
    bookmarkId ? Boolean(s.highlightsLoadedByBookmarkId[bookmarkId]) : false,
  );

  const highlights = useMemo(() => {
    if (!bookmarkId || !highlightsMap) return [];
    return selectBookmarkHighlights(
      {
        highlightsByBookmarkId: { [bookmarkId]: highlightsMap },
      } as Parameters<typeof selectBookmarkHighlights>[0],
      bookmarkId,
    );
  }, [bookmarkId, highlightsMap]);

  const [fetchErrorState, setFetchErrorState] = useState<{
    bookmarkId: string;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrorState, setSaveErrorState] = useState<{
    bookmarkId: string;
    message: string;
  } | null>(null);
  const [fieldErrorState, setFieldErrorState] = useState<{
    bookmarkId: string;
    errors: Partial<Record<keyof BookmarkFormValues, string>>;
  } | null>(null);
  const [draftState, setDraftState] = useState<{
    bookmarkId: string;
    values: BookmarkFormValues;
  } | null>(null);

  const [tagsSaving, setTagsSaving] = useState(false);
  const [tagsErrorState, setTagsErrorState] = useState<{
    bookmarkId: string;
    message: string;
  } | null>(null);

  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderErrorState, setReminderErrorState] = useState<{
    bookmarkId: string;
    message: string;
  } | null>(null);

  const [highlightsBusy, setHighlightsBusy] = useState(false);
  const [highlightsErrorState, setHighlightsErrorState] = useState<{
    bookmarkId: string;
    message: string;
  } | null>(null);

  const [archiveState, setArchiveState] = useState<{
    bookmarkId: string;
    data: BookmarkArchive | null;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    if (!bookmarkId || bookmark) {
      return;
    }

    let cancelled = false;
    bookmarksApi
      .get(bookmarkId)
      .then((fetched) => {
        if (cancelled) return;
        setFetchErrorState(null);
        upsertBookmark(fetched);
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchErrorState({
          bookmarkId,
          message: toApiError(err).detail,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [bookmark, bookmarkId, upsertBookmark]);

  useEffect(() => {
    if (!bookmarkId || !bookmark || highlightsLoaded) {
      return;
    }

    let cancelled = false;
    loadBookmarkHighlightsAction(bookmarkId)
      .then(() => {
        if (cancelled) return;
        setHighlightsErrorState(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setHighlightsErrorState({
          bookmarkId,
          message: toApiError(err).detail,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [bookmark, bookmarkId, highlightsLoaded]);

  const isDirty = Boolean(bookmarkId && draftState?.bookmarkId === bookmarkId);
  const form: BookmarkFormValues =
    isDirty && draftState ? draftState.values : bookmark ? toFormValues(bookmark) : EMPTY_FORM;

  const loadError =
    !bookmark && bookmarkId && fetchErrorState?.bookmarkId === bookmarkId
      ? fetchErrorState.message
      : null;
  const loading = Boolean(bookmarkId && !bookmark && !loadError);
  const saveError =
    bookmarkId && saveErrorState?.bookmarkId === bookmarkId ? saveErrorState.message : null;
  const fieldErrors =
    bookmarkId && fieldErrorState?.bookmarkId === bookmarkId ? fieldErrorState.errors : {};
  const tagsError =
    bookmarkId && tagsErrorState?.bookmarkId === bookmarkId ? tagsErrorState.message : null;
  const reminderError =
    bookmarkId && reminderErrorState?.bookmarkId === bookmarkId ? reminderErrorState.message : null;
  const highlightsError =
    bookmarkId && highlightsErrorState?.bookmarkId === bookmarkId
      ? highlightsErrorState.message
      : null;
  const highlightsLoading = Boolean(
    bookmarkId && bookmark && !highlightsLoaded && !highlightsError,
  );

  const currentArchiveState =
    bookmarkId && archiveState?.bookmarkId === bookmarkId ? archiveState : null;
  const archive = currentArchiveState?.data ?? null;
  const archiveLoading = currentArchiveState?.loading ?? false;
  const archiveError = currentArchiveState?.error ?? null;

  const loadArchive = useCallback(async () => {
    if (!bookmarkId) return;
    setArchiveState((prev) => ({
      bookmarkId,
      data: prev?.bookmarkId === bookmarkId ? prev.data : null,
      loading: true,
      error: null,
    }));
    try {
      const data = await bookmarksApi.getArchive(bookmarkId);
      setArchiveState({ bookmarkId, data, loading: false, error: null });
    } catch (err) {
      setArchiveState((prev) => ({
        bookmarkId,
        data: prev?.bookmarkId === bookmarkId ? prev.data : null,
        loading: false,
        error: toApiError(err).detail,
      }));
    }
  }, [bookmarkId]);

  const refreshArchiveStatus = useCallback(async () => {
    if (!bookmarkId) return;
    setArchiveState((prev) => ({
      bookmarkId,
      data: prev?.bookmarkId === bookmarkId ? prev.data : null,
      loading: true,
      error: null,
    }));
    try {
      const fresh = await bookmarksApi.get(bookmarkId);
      upsertBookmark(fresh);
      if (fresh.cacheStatus === 'ready') {
        const data = await bookmarksApi.getArchive(bookmarkId);
        setArchiveState({ bookmarkId, data, loading: false, error: null });
      } else {
        setArchiveState({ bookmarkId, data: null, loading: false, error: null });
      }
    } catch (err) {
      setArchiveState((prev) => ({
        bookmarkId,
        data: prev?.bookmarkId === bookmarkId ? prev.data : null,
        loading: false,
        error: toApiError(err).detail,
      }));
    }
  }, [bookmarkId, upsertBookmark]);

  const reindex = async (): Promise<boolean> => {
    if (!bookmark || !bookmarkId || reindexing) return false;
    setReindexing(true);
    try {
      await reindexBookmarkAction(bookmark.id);
      return true;
    } catch {
      return false;
    } finally {
      setReindexing(false);
    }
  };

  const downloadFile = async (): Promise<void> => {
    if (!bookmark || bookmark.storageKind !== 'file') return;
    await downloadBookmarkFileAction(bookmark).catch(() => undefined);
  };

  const setField = (field: keyof BookmarkFormValues, value: string) => {
    if (!bookmarkId) return;
    setSaveErrorState(null);
    setFieldErrorState((prev) =>
      prev && prev.bookmarkId === bookmarkId
        ? { bookmarkId, errors: { ...prev.errors, [field]: undefined } }
        : null,
    );
    setDraftState((prev) => {
      const baseValues =
        prev && prev.bookmarkId === bookmarkId
          ? prev.values
          : bookmark
            ? toFormValues(bookmark)
            : EMPTY_FORM;
      return {
        bookmarkId,
        values: {
          ...baseValues,
          [field]: value,
        },
      };
    });
  };

  const resetEdits = () => {
    setDraftState(null);
    setFieldErrorState(null);
    setSaveErrorState(null);
  };

  const save = async (): Promise<boolean> => {
    if (!bookmark || !bookmarkId || saving) return false;
    setSaveErrorState(null);

    const candidate: UpdateBookmarkRequest = {
      title: normalizeNullableField(form.title),
      excerpt: normalizeNullableField(form.excerpt),
      note: normalizeNullableField(form.note),
    };

    if (bookmark.storageKind === 'url') {
      const trimmedUrl = form.url.trim();
      if (trimmedUrl !== (bookmark.url ?? '')) {
        candidate.url = trimmedUrl;
      }
    }

    const parsed = updateBookmarkRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      const nextErrors: Partial<Record<keyof BookmarkFormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof BookmarkFormValues | undefined;
        if (key && !nextErrors[key]) {
          nextErrors[key] = issue.message;
        }
      }
      setFieldErrorState({ bookmarkId, errors: nextErrors });
      return false;
    }

    setSaving(true);
    try {
      await updateBookmarkDetailsAction(bookmark.id, parsed.data);
      setDraftState(null);
      setFieldErrorState(null);
      return true;
    } catch (err) {
      setSaveErrorState({ bookmarkId, message: toApiError(err).detail });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveTags = async (tags: string[]): Promise<boolean> => {
    if (!bookmark || !bookmarkId || tagsSaving) return false;
    setTagsErrorState(null);
    setTagsSaving(true);
    try {
      await replaceBookmarkTagsAction(bookmark.id, tags);
      return true;
    } catch (err) {
      setTagsErrorState({ bookmarkId, message: toApiError(err).detail });
      return false;
    } finally {
      setTagsSaving(false);
    }
  };

  const saveReminder = async (reminderAt: string | null): Promise<boolean> => {
    if (!bookmark || !bookmarkId || reminderSaving) return false;
    setReminderErrorState(null);
    setReminderSaving(true);
    try {
      await updateBookmarkDetailsAction(bookmark.id, { reminderAt });
      return true;
    } catch (err) {
      setReminderErrorState({ bookmarkId, message: toApiError(err).detail });
      return false;
    } finally {
      setReminderSaving(false);
    }
  };

  const createHighlight = async (input: CreateHighlightRequest): Promise<boolean> => {
    if (!bookmark || !bookmarkId || highlightsBusy) return false;
    setHighlightsErrorState(null);
    setHighlightsBusy(true);
    try {
      await createHighlightAction(bookmark.id, input);
      return true;
    } catch (err) {
      setHighlightsErrorState({ bookmarkId, message: toApiError(err).detail });
      return false;
    } finally {
      setHighlightsBusy(false);
    }
  };

  const updateHighlight = async (
    highlightId: string,
    input: UpdateHighlightRequest,
  ): Promise<boolean> => {
    if (!bookmark || !bookmarkId || highlightsBusy) return false;
    setHighlightsErrorState(null);
    setHighlightsBusy(true);
    try {
      await updateHighlightAction(highlightId, input);
      return true;
    } catch (err) {
      setHighlightsErrorState({ bookmarkId, message: toApiError(err).detail });
      return false;
    } finally {
      setHighlightsBusy(false);
    }
  };

  const deleteHighlight = async (highlightId: string): Promise<boolean> => {
    if (!bookmark || !bookmarkId || highlightsBusy) return false;
    setHighlightsErrorState(null);
    setHighlightsBusy(true);
    try {
      await deleteHighlightAction(bookmark.id, highlightId);
      return true;
    } catch (err) {
      setHighlightsErrorState({ bookmarkId, message: toApiError(err).detail });
      return false;
    } finally {
      setHighlightsBusy(false);
    }
  };

  const toggleFavorite = async () => {
    if (!bookmark) return;
    try {
      await toggleBookmarkFavoriteAction(bookmark);
    } catch {
      // Action rolls back and notifies via SnackbarHost.
    }
  };

  const trash = async (): Promise<boolean> => {
    if (!bookmark || !bookmarkId || saving) return false;
    setSaving(true);
    try {
      await trashBookmarkAction(bookmark);
      return true;
    } catch (err) {
      setSaveErrorState({ bookmarkId, message: toApiError(err).detail });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const restore = async (): Promise<boolean> => {
    if (!bookmark || !bookmarkId || saving) return false;
    setSaving(true);
    try {
      await restoreBookmarkAction(bookmark.id);
      return true;
    } catch (err) {
      setSaveErrorState({ bookmarkId, message: toApiError(err).detail });
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    bookmark,
    loading,
    loadError,
    saving,
    saveError,
    fieldErrors,
    form,
    isDirty,
    setField,
    resetEdits,
    save,
    tagsSaving,
    tagsError,
    saveTags,
    reminderSaving,
    reminderError,
    saveReminder,
    highlights,
    highlightsLoading,
    highlightsBusy,
    highlightsError,
    createHighlight,
    updateHighlight,
    deleteHighlight,
    toggleFavorite,
    trash,
    restore,
    archive,
    archiveLoading,
    archiveError,
    reindexing,
    loadArchive,
    refreshArchiveStatus,
    reindex,
    downloadFile,
  };
}
