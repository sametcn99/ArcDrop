import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/routes';
import type { BookmarkCacheStatus } from '../../api/schemas/bookmarks';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import {
  makeMockBookmark,
  makeMockBookmarkArchive,
  makeMockSession,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { waitForBootstrapReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';

function renderDetailAt(path: string) {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'reader@arcdrop.test' },
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

describe('BookmarkDetail Archive reader & file integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders archived HTML inside a sandboxed iframe without allow-scripts and supports plain-text tab fallback', async () => {
    const user = userEvent.setup({ delay: null });

    const bookmark = makeMockBookmark({
      id: 'bm-arch-1',
      title: 'Sandboxed Article',
      cacheStatus: 'ready',
      cacheCheckedAt: '2026-11-14T10:00:00.000Z',
    });
    const archive = makeMockBookmarkArchive({
      bookmarkId: 'bm-arch-1',
      cacheStatus: 'ready',
      html: '<article><h2>Saved Heading</h2><p>Clean archived paragraph.</p></article>',
      text: 'Saved Heading\n\nClean archived paragraph.',
    });

    server.use(
      http.get('*/api/v1/bookmarks/bm-arch-1', () => HttpResponse.json(bookmark)),
      http.get('*/api/v1/bookmarks/bm-arch-1/archive', () => HttpResponse.json(archive)),
    );

    renderDetailAt('/bookmarks/bm-arch-1');
    await waitForBootstrapReady();

    await user.click(await screen.findByTestId('bookmark-detail-tab-archive'));

    const iframe = await screen.findByTestId('archive-html-iframe');
    expect(iframe.tagName.toLowerCase()).toBe('iframe');
    expect(iframe).toHaveAttribute('sandbox', '');
    expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(iframe).toHaveAttribute('srcdoc', archive.html);

    await user.click(screen.getByRole('button', { name: 'Plain text' }));
    const textView = await screen.findByTestId('archive-text-view');
    expect(textView).toHaveTextContent('Saved Heading');
    expect(textView).toHaveTextContent('Clean archived paragraph.');
  }, 60_000);

  it.each<[BookmarkCacheStatus, string]>([
    ['pending', 'Archive: Pending'],
    ['ready', 'Archive: Ready'],
    ['failed', 'Archive: Failed'],
    ['invalid-origin', 'Archive: Invalid origin'],
    ['skipped', 'Archive: Skipped'],
  ])(
    'renders cacheStatus chip for state %s (%s)',
    async (status, expectedLabel) => {
      const user = userEvent.setup({ delay: null });
      const bookmark = makeMockBookmark({
        id: `bm-status-${status}`,
        cacheStatus: status,
      });

      server.use(
        http.get(`*/api/v1/bookmarks/bm-status-${status}`, () => HttpResponse.json(bookmark)),
        http.get(`*/api/v1/bookmarks/bm-status-${status}/archive`, () =>
          HttpResponse.json(
            makeMockBookmarkArchive({
              bookmarkId: `bm-status-${status}`,
              cacheStatus: status,
            }),
          ),
        ),
      );

      renderDetailAt(`/bookmarks/bm-status-${status}`);
      await waitForBootstrapReady();

      await user.click(await screen.findByTestId('bookmark-detail-tab-archive'));

      const chip = await screen.findByTestId(`cache-status-chip-${status}`);
      expect(chip).toHaveTextContent(expectedLabel);
    },
    60_000,
  );

  it('triggers POST /bookmarks/:id/reindex, updates status to pending, and refreshes archive', async () => {
    const user = userEvent.setup({ delay: null });
    let reindexCalls = 0;
    let getCalls = 0;

    server.use(
      http.get('*/api/v1/bookmarks/bm-reindex', () => {
        getCalls += 1;
        return HttpResponse.json(
          makeMockBookmark({
            id: 'bm-reindex',
            cacheStatus: getCalls === 1 ? 'failed' : 'ready',
            cacheCheckedAt: '2026-11-14T11:00:00.000Z',
          }),
        );
      }),
      http.post('*/api/v1/bookmarks/bm-reindex/reindex', () => {
        reindexCalls += 1;
        return HttpResponse.json({ id: 'bm-reindex', status: 'scheduled' }, { status: 202 });
      }),
      http.get('*/api/v1/bookmarks/bm-reindex/archive', () =>
        HttpResponse.json(
          makeMockBookmarkArchive({
            bookmarkId: 'bm-reindex',
            html: '<article><p>Reindexed fresh archive</p></article>',
            text: 'Reindexed fresh archive',
          }),
        ),
      ),
    );

    renderDetailAt('/bookmarks/bm-reindex?tab=archive');
    await waitForBootstrapReady();

    expect(await screen.findByTestId('cache-status-chip-failed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reindex' }));

    await waitFor(() => {
      expect(reindexCalls).toBe(1);
    });
    expect(await screen.findByTestId('cache-status-chip-pending')).toBeInTheDocument();
    expect(await screen.findByText('Archive refresh scheduled.')).toBeInTheDocument();

    // Refresh fetches updated bookmark -> now ready -> loads archive iframe
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const iframe = await screen.findByTestId('archive-html-iframe');
    expect(iframe).toHaveAttribute('srcdoc', '<article><p>Reindexed fresh archive</p></article>');
  }, 60_000);

  it('shows authenticated image preview for image file items and links text file items to archive text without URL edit or reindex', async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://arcdrop.test/detail-img');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const imageFile = makeMockBookmark({
      id: 'bm-img-detail',
      storageKind: 'file',
      title: 'Diagram PNG',
      fileRef: 'ref-diagram-png',
      fileName: 'diagram.png',
      fileMime: 'image/png',
      fileSize: 4096,
      contentType: 'image',
      cacheStatus: 'skipped',
    });

    const textFile = makeMockBookmark({
      id: 'bm-txt-detail',
      storageKind: 'file',
      title: 'Design Notes',
      fileRef: 'ref-notes-txt',
      fileName: 'notes.txt',
      fileMime: 'text/plain',
      fileSize: 512,
      contentType: 'document',
      cacheStatus: 'ready',
    });

    server.use(
      http.get('*/api/v1/bookmarks/bm-img-detail', () => HttpResponse.json(imageFile)),
      http.get('*/api/v1/bookmarks/bm-txt-detail', () => HttpResponse.json(textFile)),
      http.get(
        '*/api/v1/files/bm-img-detail',
        () =>
          new HttpResponse(new Uint8Array([137, 80, 78, 71]), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          }),
      ),
      http.get('*/api/v1/bookmarks/bm-txt-detail/archive', () =>
        HttpResponse.json(
          makeMockBookmarkArchive({
            bookmarkId: 'bm-txt-detail',
            html: '<pre>Line one\nLine two</pre>',
            text: 'Line one\nLine two',
          }),
        ),
      ),
    );

    const firstRender = renderDetailAt('/bookmarks/bm-img-detail');
    await waitForBootstrapReady();

    const imgPreview = await screen.findByTestId('file-image-preview-bm-img-detail');
    expect(imgPreview).toHaveAttribute('src', 'blob:https://arcdrop.test/detail-img');
    expect(screen.getByLabelText('URL')).toBeDisabled();

    await user.click(screen.getByTestId('bookmark-detail-tab-archive'));
    expect(screen.queryByRole('button', { name: 'Reindex' })).not.toBeInTheDocument();
    expect(screen.getByText(/File-backed items are extracted on upload/)).toBeInTheDocument();

    firstRender.unmount();

    renderDetailAt('/bookmarks/bm-txt-detail');
    await waitForBootstrapReady();

    const fileSection = await screen.findByTestId('bookmark-file-section');
    await user.click(within(fileSection).getByRole('button', { name: 'Read extracted text' }));

    const textView = await screen.findByTestId('archive-text-view');
    expect(textView).toHaveTextContent('Line one');
    expect(textView).toHaveTextContent('Line two');
  }, 60_000);
});
