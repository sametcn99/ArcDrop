import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import type { Highlight } from '../../api/schemas/bookmarks';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import { useLibraryStore } from '../../stores/libraryStore';
import {
  makeMockBookmark,
  makeMockHighlight,
  makeMockSession,
  makeMockTagUsage,
  problemJsonResponse,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { waitForBootstrapReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';
import BookmarkDetailPage from './index';

function renderDetailAt(path: string) {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'editor@arcdrop.test' },
    }),
  );

  const router = createMemoryRouter(appRoutes, {
    initialEntries: [path],
  });

  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

function renderDetailDrawerOnly(path: string) {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'editor@arcdrop.test' },
    }),
  );

  return render(
    <ThemeController>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/bookmarks/:bookmarkId" element={<BookmarkDetailPage />} />
        </Routes>
      </MemoryRouter>
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('BookmarkDetail drawer', () => {
  it('views and edits title, url, excerpt, and note through the API client', async () => {
    const user = userEvent.setup({ delay: null });
    let capturedPayload: Record<string, unknown> | null = null;

    const bookmark = makeMockBookmark({
      id: 'bm-edit',
      title: 'Original Heading',
      url: 'https://arcdrop.test/original',
      excerpt: 'Initial summary',
      note: 'Initial note',
    });

    server.use(
      http.get('*/api/v1/bookmarks/bm-edit', () => HttpResponse.json(bookmark)),
      http.put('*/api/v1/bookmarks/bm-edit', async ({ request }) => {
        capturedPayload = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          ...bookmark,
          ...capturedPayload,
          updatedAt: '2026-11-14T05:00:00.000Z',
        });
      }),
    );

    renderDetailDrawerOnly('/bookmarks/bm-edit');

    expect(await screen.findByRole('heading', { name: 'Bookmark detail' })).toBeInTheDocument();
    const titleInput = await screen.findByLabelText('Title');
    const urlInput = screen.getByLabelText('URL');
    const excerptInput = screen.getByLabelText('Excerpt');
    const noteInput = screen.getByLabelText('Note');

    fireEvent.change(titleInput, { target: { value: 'Updated Heading' } });
    fireEvent.change(urlInput, { target: { value: 'https://arcdrop.test/updated' } });
    fireEvent.change(excerptInput, { target: { value: 'Updated summary' } });
    fireEvent.change(noteInput, { target: { value: 'Updated private note' } });

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(capturedPayload).toEqual({
        title: 'Updated Heading',
        url: 'https://arcdrop.test/updated',
        excerpt: 'Updated summary',
        note: 'Updated private note',
      });
    });

    expect(useLibraryStore.getState().bookmarksById['bm-edit']?.title).toBe('Updated Heading');
    expect(await screen.findByText('Bookmark updated.')).toBeInTheDocument();
  }, 60_000);

  it('disables URL editing on file-backed bookmarks and supports trash + restore', async () => {
    const user = userEvent.setup({ delay: null });
    let deleteCalled = false;

    const fileBookmark = makeMockBookmark({
      id: 'bm-file',
      storageKind: 'file',
      title: 'Quarterly Report PDF',
      fileName: 'report.pdf',
      fileMime: 'application/pdf',
      fileSize: 102400,
      contentType: 'document',
    });

    server.use(
      http.get('*/api/v1/bookmarks/bm-file', () => HttpResponse.json(fileBookmark)),
      http.delete('*/api/v1/bookmarks/bm-file', () => {
        deleteCalled = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderDetailAt('/bookmarks/bm-file');
    await waitForBootstrapReady();

    const urlField = await screen.findByLabelText('URL');
    expect(urlField).toBeDisabled();
    expect(screen.getByText('File-backed bookmarks cannot change their URL.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move to trash' }));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
  }, 60_000);

  it('shows restore banner for trashed bookmarks with read-only highlights and restores via API', async () => {
    const user = userEvent.setup({ delay: null });
    let restoreCalled = false;

    const trashedBookmark = makeMockBookmark({
      id: 'bm-trashed',
      title: 'Deleted Note',
      deletedAt: '2026-11-14T02:00:00.000Z',
    });
    const existingHighlight = makeMockHighlight({
      id: 'hl-trashed-1',
      bookmarkId: 'bm-trashed',
      text: 'Preserved excerpt from trashed bookmark',
      note: 'Still readable',
    });

    server.use(
      http.get('*/api/v1/bookmarks/bm-trashed', () => HttpResponse.json(trashedBookmark)),
      http.get('*/api/v1/bookmarks/bm-trashed/highlights', () =>
        HttpResponse.json({ items: [existingHighlight] }),
      ),
      http.post('*/api/v1/bookmarks/bm-trashed/restore', () => {
        restoreCalled = true;
        return HttpResponse.json({
          ...trashedBookmark,
          deletedAt: null,
          updatedAt: '2026-11-14T06:00:00.000Z',
        });
      }),
    );

    renderDetailDrawerOnly('/bookmarks/bm-trashed');

    expect(
      await screen.findByText(
        'This bookmark is currently in the trash. Restore it to edit its fields.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByLabelText('Tags')).toBeDisabled();
    expect(await screen.findByText('Preserved excerpt from trashed bookmark')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This bookmark is in the trash. Existing highlights remain readable, while creating, editing, and deleting highlights are disabled.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add highlight' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Restore bookmark' }));

    await waitFor(() => {
      expect(restoreCalled).toBe(true);
    });
    expect(screen.getByLabelText('Title')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add highlight' })).toBeInTheDocument();
  }, 60_000);

  it('replaces bookmark tags using autocomplete and PUT /bookmarks/:id/tags', async () => {
    const user = userEvent.setup({ delay: null });
    let capturedTags: string[] | null = null;

    const bookmark = makeMockBookmark({
      id: 'bm-tags',
      tags: [{ id: 'tag-1', name: 'architecture' }],
    });

    server.use(
      http.get('*/api/v1/bookmarks/tags', () =>
        HttpResponse.json([
          makeMockTagUsage({ id: 'tag-1', name: 'architecture', count: 2 }),
          makeMockTagUsage({ id: 'tag-2', name: 'reading', count: 1 }),
        ]),
      ),
      http.get('*/api/v1/bookmarks/bm-tags', () => HttpResponse.json(bookmark)),
      http.put('*/api/v1/bookmarks/bm-tags/tags', async ({ request }) => {
        const body = (await request.json()) as { tags: string[] };
        capturedTags = body.tags;
        return HttpResponse.json({
          ...bookmark,
          tags: body.tags.map((name, index) => ({ id: `tag-res-${index}`, name })),
        });
      }),
    );

    renderDetailAt('/bookmarks/bm-tags');
    await waitForBootstrapReady();

    const tagsSection = await screen.findByTestId('bookmark-tags-section');
    const tagInput = within(tagsSection).getByRole('combobox', { name: 'Tags' });

    await user.click(tagInput);
    const option = await screen.findByRole('option', { name: 'reading' });
    await user.click(option);

    await user.type(tagInput, 'urgent{Enter}');

    await user.click(within(tagsSection).getByRole('button', { name: 'Save tags' }));

    await waitFor(() => {
      expect(capturedTags).toEqual(['architecture', 'reading', 'urgent']);
    });
    expect(await screen.findByText('Tags updated.')).toBeInTheDocument();
  }, 60_000);

  it('supports highlight CRUD in the drawer', async () => {
    const user = userEvent.setup({ delay: null });
    let highlights: Highlight[] = [
      makeMockHighlight({
        id: 'hl-1',
        bookmarkId: 'bm-hl',
        text: 'Initial quote',
        note: 'Initial hl note',
        color: 'amber',
      }),
    ];

    const bookmark = makeMockBookmark({ id: 'bm-hl', title: 'Highlight Target' });

    server.use(
      http.get('*/api/v1/bookmarks/bm-hl', () => HttpResponse.json(bookmark)),
      http.get('*/api/v1/bookmarks/bm-hl/highlights', () =>
        HttpResponse.json({ items: highlights }),
      ),
      http.post('*/api/v1/bookmarks/bm-hl/highlights', async ({ request }) => {
        const body = (await request.json()) as {
          text: string;
          note?: string | null;
          color?: string | null;
        };
        const created = makeMockHighlight({
          id: 'hl-2',
          bookmarkId: 'bm-hl',
          text: body.text,
          note: body.note ?? null,
          color: body.color ?? null,
        });
        highlights = [...highlights, created];
        return HttpResponse.json(created, { status: 201 });
      }),
      http.put('*/api/v1/highlights/hl-2', async ({ request }) => {
        const body = (await request.json()) as { text?: string; note?: string | null };
        const updated = makeMockHighlight({
          id: 'hl-2',
          bookmarkId: 'bm-hl',
          text: body.text ?? 'Quote v2',
          note: body.note ?? null,
          color: 'mint',
        });
        highlights = highlights.map((item) => (item.id === 'hl-2' ? updated : item));
        return HttpResponse.json(updated);
      }),
      http.delete('*/api/v1/highlights/hl-1', () => {
        highlights = highlights.filter((item) => item.id !== 'hl-1');
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderDetailDrawerOnly('/bookmarks/bm-hl');

    const hlSection = await screen.findByTestId('bookmark-highlights-section');
    expect(await within(hlSection).findByText('Initial quote')).toBeInTheDocument();

    // Create highlight
    await user.click(within(hlSection).getByRole('button', { name: 'Add highlight' }));
    fireEvent.change(within(hlSection).getByLabelText('Passage text'), {
      target: { value: 'Second important quote' },
    });
    fireEvent.change(within(hlSection).getByLabelText('Highlight note'), {
      target: { value: 'Follow up note' },
    });
    await user.click(within(hlSection).getByRole('button', { name: 'Mint' }));
    await user.click(within(hlSection).getByRole('button', { name: 'Save highlight' }));

    expect(await within(hlSection).findByText('Second important quote')).toBeInTheDocument();
    expect(within(hlSection).getByText('Follow up note')).toBeInTheDocument();

    // Edit newly created highlight
    await user.click(within(hlSection).getByRole('button', { name: 'Edit highlight hl-2' }));
    fireEvent.change(within(hlSection).getByLabelText('Passage text'), {
      target: { value: 'Second quote edited' },
    });
    await user.click(within(hlSection).getByRole('button', { name: 'Update highlight' }));

    expect(await within(hlSection).findByText('Second quote edited')).toBeInTheDocument();

    // Delete first highlight
    await user.click(within(hlSection).getByRole('button', { name: 'Delete highlight hl-1' }));
    await waitFor(() => {
      expect(within(hlSection).queryByText('Initial quote')).not.toBeInTheDocument();
    });
  }, 120_000);

  it('surfaces API trash-refusal errors when highlight mutation is rejected', async () => {
    const user = userEvent.setup({ delay: null });
    const bookmark = makeMockBookmark({ id: 'bm-hl-refuse', title: 'Trashed Remotely' });

    server.use(
      http.get('*/api/v1/bookmarks/bm-hl-refuse', () => HttpResponse.json(bookmark)),
      http.get('*/api/v1/bookmarks/bm-hl-refuse/highlights', () =>
        HttpResponse.json({ items: [] }),
      ),
      http.post('*/api/v1/bookmarks/bm-hl-refuse/highlights', () =>
        problemJsonResponse(404, {
          code: 'NOT_FOUND',
          title: 'Not Found',
          detail: 'Cannot add highlight to a trashed bookmark',
        }),
      ),
    );

    renderDetailDrawerOnly('/bookmarks/bm-hl-refuse');

    const hlSection = await screen.findByTestId('bookmark-highlights-section');
    const addBtn = await within(hlSection).findByRole('button', { name: 'Add highlight' });
    await user.click(addBtn);
    fireEvent.change(within(hlSection).getByLabelText('Passage text'), {
      target: { value: 'Blocked highlight' },
    });
    await user.click(within(hlSection).getByRole('button', { name: 'Save highlight' }));

    expect(
      await within(hlSection).findByText('Cannot add highlight to a trashed bookmark'),
    ).toBeInTheDocument();
  }, 60_000);

  it('renders markdown headings, lists, and links through MUI components in Note preview', async () => {
    const user = userEvent.setup({ delay: null });
    const markdownNote = [
      '# Reading Summary',
      '',
      '- First insight',
      '- Second insight',
      '',
      '[Architecture Spec](https://arcdrop.test/spec)',
    ].join('\n');

    const bookmark = makeMockBookmark({
      id: 'bm-md',
      note: markdownNote,
    });

    server.use(http.get('*/api/v1/bookmarks/bm-md', () => HttpResponse.json(bookmark)));

    renderDetailDrawerOnly('/bookmarks/bm-md');

    await screen.findByLabelText('Note');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const preview = await screen.findByTestId('markdown-preview');
    const heading = within(preview).getByRole('heading', { level: 1, name: 'Reading Summary' });
    expect(heading).toHaveClass('MuiTypography-root');

    expect(within(preview).getByText('First insight').closest('li')).toHaveClass(
      'MuiTypography-root',
    );
    expect(within(preview).getByText('Second insight').closest('li')).toHaveClass(
      'MuiTypography-root',
    );

    const link = within(preview).getByRole('link', { name: 'Architecture Spec' });
    expect(link).toHaveClass('MuiLink-root');
    expect(link).toHaveAttribute('href', 'https://arcdrop.test/spec');
  }, 60_000);
});
