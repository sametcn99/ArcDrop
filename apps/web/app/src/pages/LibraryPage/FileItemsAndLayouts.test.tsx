import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import {
  makeMockBookmark,
  makeMockBookmarkArchive,
  makeMockSession,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { waitForLibraryReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';

function renderAt(path: string) {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'files@arcdrop.test' },
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

describe('File items across all layouts & archive text links', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders authenticated image preview and text file archive-text link across all four layouts', async () => {
    const user = userEvent.setup({ delay: null });
    const filePreviewAuthHeaders: string[] = [];

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://arcdrop.test/preview-thumb');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const imageBookmark = makeMockBookmark({
      id: 'bm-file-img',
      storageKind: 'file',
      title: 'Architecture Photo',
      fileRef: 'ref-img-1',
      fileName: 'architecture.png',
      fileMime: 'image/png',
      fileSize: 15_360,
      contentType: 'image',
      cacheStatus: 'skipped',
      tags: [],
    });

    const textBookmark = makeMockBookmark({
      id: 'bm-file-txt',
      storageKind: 'file',
      title: 'Meeting Notes',
      fileRef: 'ref-txt-1',
      fileName: 'meeting-notes.md',
      fileMime: 'text/markdown',
      fileSize: 2048,
      contentType: 'document',
      cacheStatus: 'ready',
      tags: [],
    });

    const audioBookmark = makeMockBookmark({
      id: 'bm-file-aud',
      storageKind: 'file',
      title: 'Podcast Episode',
      fileRef: 'ref-aud-1',
      fileName: 'episode.mp3',
      fileMime: 'audio/mpeg',
      fileSize: 5_242_880,
      contentType: 'audio',
      cacheStatus: 'skipped',
      tags: [],
    });

    server.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({
          items: [imageBookmark, textBookmark, audioBookmark],
          totalCount: 3,
          page: 1,
          pageSize: 24,
        }),
      ),
      http.get('*/api/v1/files/bm-file-img', ({ request }) => {
        filePreviewAuthHeaders.push(request.headers.get('authorization') ?? '');
        return new HttpResponse(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
      }),
      http.get('*/api/v1/bookmarks/bm-file-txt', () => HttpResponse.json(textBookmark)),
      http.get('*/api/v1/bookmarks/bm-file-txt/archive', () =>
        HttpResponse.json(
          makeMockBookmarkArchive({
            bookmarkId: 'bm-file-txt',
            html: '<h1>Meeting Notes</h1><p>Action items synced.</p>',
            text: 'Meeting Notes\n\nAction items synced.',
          }),
        ),
      ),
    );

    renderAt('/');
    await waitForLibraryReady();

    // List layout: image preview, text file archive link, audio download button
    expect(await screen.findByTestId('library-layout-list')).toBeInTheDocument();
    const imgPreview = await screen.findByTestId('file-image-preview-bm-file-img');
    expect(imgPreview).toHaveAttribute('src', 'blob:https://arcdrop.test/preview-thumb');
    expect(filePreviewAuthHeaders[0]).toMatch(/^Bearer /);

    const textCard = screen.getByTestId('bookmark-item-bm-file-txt');
    const archiveLink = within(textCard).getByRole('link', { name: 'Archive text' });
    expect(archiveLink).toHaveAttribute('href', '/bookmarks/bm-file-txt?tab=archive&view=text');

    const audioCard = screen.getByTestId('bookmark-item-bm-file-aud');
    expect(
      within(audioCard).getByRole('button', { name: 'Download file: Podcast Episode' }),
    ).toBeInTheDocument();

    // Grid layout
    await user.click(screen.getByRole('button', { name: 'Grid' }));
    expect(await screen.findByTestId('library-layout-grid')).toBeInTheDocument();
    expect(await screen.findByTestId('file-image-preview-bm-file-img')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('bookmark-item-bm-file-txt')).getByRole('link', {
        name: 'Archive text',
      }),
    ).toBeInTheDocument();

    // Headlines layout
    await user.click(screen.getByRole('button', { name: 'Headlines' }));
    expect(await screen.findByTestId('library-layout-headlines')).toBeInTheDocument();
    expect(await screen.findByTestId('file-image-preview-bm-file-img')).toBeInTheDocument();

    // Moodboard layout
    await user.click(screen.getByRole('button', { name: 'Moodboard' }));
    expect(await screen.findByTestId('library-layout-moodboard')).toBeInTheDocument();
    expect(await screen.findByTestId('file-image-preview-bm-file-img')).toBeInTheDocument();

    // Clicking the Archive text link navigates straight to the Archive Plain text view
    const moodTextCard = screen.getByTestId('bookmark-item-bm-file-txt');
    await user.click(within(moodTextCard).getByRole('link', { name: 'Archive text' }));

    const archiveTextView = await screen.findByTestId('archive-text-view');
    expect(archiveTextView).toHaveTextContent('Action items synced.');
  }, 60_000);
});
