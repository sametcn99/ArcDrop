import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bookmark } from '../../api/schemas/bookmarks';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useUiStore } from '../../stores/uiStore';
import { makeMockBookmark } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { BOOKMARK_DETAIL_STRINGS } from './strings';
import { BookmarkDetailForm } from './components/BookmarkDetailForm';

function stubProps(bookmark: Bookmark) {
  return {
    bookmark,
    form: { title: bookmark.title ?? '', url: bookmark.url ?? '', excerpt: '', note: '' },
    fieldErrors: {},
    saveError: null,
    saving: false,
    isDirty: false,
    onFieldChange: vi.fn(),
    onReset: vi.fn(),
    onSave: vi.fn().mockResolvedValue(true),
    tagsSaving: false,
    tagsError: null,
    onSaveTags: vi.fn().mockResolvedValue(true),
    reminderSaving: false,
    reminderError: null,
    onSaveReminder: vi.fn().mockResolvedValue(true),
    highlights: [],
    highlightsLoading: false,
    highlightsBusy: false,
    highlightsError: null,
    onCreateHighlight: vi.fn().mockResolvedValue(true),
    onUpdateHighlight: vi.fn().mockResolvedValue(true),
    onDeleteHighlight: vi.fn().mockResolvedValue(true),
    onToggleFavorite: vi.fn(),
    onTrash: vi.fn(),
    onRestore: vi.fn(),
  };
}

function renderForm(bookmark: Bookmark) {
  return render(
    <>
      <BookmarkDetailForm {...stubProps(bookmark)} />
      <SnackbarHost />
    </>,
  );
}

describe('BookmarkDetailForm share action (plan T3)', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window.navigator, 'share');
    Reflect.deleteProperty(window.navigator, 'clipboard');
    server.resetHandlers();
  });

  it('routes the share through the platform adapter with title and url', async () => {
    const user = userEvent.setup();
    const shareMock = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });

    renderForm(makeMockBookmark({ title: 'Guide', url: 'https://arcdrop.test/docs' }));
    await user.click(
      await screen.findByRole('button', { name: BOOKMARK_DETAIL_STRINGS.shareLabel }),
    );

    expect(shareMock).toHaveBeenCalledWith({ text: 'Guide', url: 'https://arcdrop.test/docs' });
    expect(useUiStore.getState().snackbars).toHaveLength(0);
  });

  it('falls back to copying the link with a snackbar when sharing is unsupported', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderForm(makeMockBookmark({ title: 'Guide', url: 'https://arcdrop.test/docs' }));
    await user.click(
      await screen.findByRole('button', { name: BOOKMARK_DETAIL_STRINGS.shareLabel }),
    );

    expect(writeText).toHaveBeenCalledWith('https://arcdrop.test/docs');
    await screen.findByText(BOOKMARK_DETAIL_STRINGS.shareCopiedFallback);
  });
});
