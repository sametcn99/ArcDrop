import { useEffect, useState } from 'react';
import { bookmarksApi } from '../../../api/endpoints/bookmarks';
import {
  updateBookmarkRequestSchema,
  type Bookmark,
  type UpdateBookmarkRequest,
} from '../../../api/schemas/bookmarks';
import { toApiError } from '../../../api/schemas/problem';
import {
  restoreBookmarkAction,
  toggleBookmarkFavoriteAction,
  trashBookmarkAction,
  updateBookmarkDetailsAction,
} from '../../../shared/actions/bookmarkActions';
import { useLibraryStore } from '../../../stores/libraryStore';

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
    toggleFavorite,
    trash,
    restore,
  };
}
