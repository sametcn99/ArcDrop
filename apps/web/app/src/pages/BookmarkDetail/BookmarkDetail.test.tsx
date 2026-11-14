import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { makeMockBookmark, makeMockSession } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';

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

describe('BookmarkDetail drawer', () => {
  it('views and edits title, url, excerpt, and note through the API client', async () => {
    const user = userEvent.setup();
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

    renderDetailAt('/bookmarks/bm-edit');

    expect(await screen.findByRole('heading', { name: 'Bookmark detail' })).toBeInTheDocument();
    const titleInput = await screen.findByLabelText('Title');
    const urlInput = screen.getByLabelText('URL');
    const excerptInput = screen.getByLabelText('Excerpt');
    const noteInput = screen.getByLabelText('Note');

    await user.clear(titleInput);
    await user.type(titleInput, 'Updated Heading');
    await user.clear(urlInput);
    await user.type(urlInput, 'https://arcdrop.test/updated');
    await user.clear(excerptInput);
    await user.type(excerptInput, 'Updated summary');
    await user.clear(noteInput);
    await user.type(noteInput, 'Updated private note');

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
  });

  it('disables URL editing on file-backed bookmarks and supports trash + restore', async () => {
    const user = userEvent.setup();
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

    const urlField = await screen.findByLabelText('URL');
    expect(urlField).toBeDisabled();
    expect(screen.getByText('File-backed bookmarks cannot change their URL.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Move to trash' }));

    await waitFor(() => {
      expect(deleteCalled).toBe(true);
    });
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
  });

  it('shows restore banner for trashed bookmarks and restores via API', async () => {
    const user = userEvent.setup();
    let restoreCalled = false;

    const trashedBookmark = makeMockBookmark({
      id: 'bm-trashed',
      title: 'Deleted Note',
      deletedAt: '2026-11-14T02:00:00.000Z',
    });

    server.use(
      http.get('*/api/v1/bookmarks/bm-trashed', () => HttpResponse.json(trashedBookmark)),
      http.post('*/api/v1/bookmarks/bm-trashed/restore', () => {
        restoreCalled = true;
        return HttpResponse.json({
          ...trashedBookmark,
          deletedAt: null,
          updatedAt: '2026-11-14T06:00:00.000Z',
        });
      }),
    );

    renderDetailAt('/bookmarks/bm-trashed');

    expect(
      await screen.findByText(
        'This bookmark is currently in the trash. Restore it to edit its fields.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Restore bookmark' }));

    await waitFor(() => {
      expect(restoreCalled).toBe(true);
    });
    expect(screen.getByLabelText('Title')).not.toBeDisabled();
  });
});
