import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { makeMockBookmark, makeMockSession, problemJsonResponse } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { testFakeWsController } from '../../test/setup';
import { ThemeController } from '../../theme/ThemeController';

function renderLibraryAt(path = '/') {
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

describe('LibraryPage', () => {
  it('renders fixture bookmarks across all four layouts (list, grid, headlines, moodboard)', async () => {
    const user = userEvent.setup();
    renderLibraryAt('/');

    expect(await screen.findByText('ArcDrop Architecture Guide')).toBeInTheDocument();
    expect(screen.getByText('MUI Design Tokens Reference')).toBeInTheDocument();
    expect(screen.getByTestId('library-layout-list')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Grid' }));
    expect(screen.getByTestId('library-layout-grid')).toBeInTheDocument();
    expect(screen.getByText('ArcDrop Architecture Guide')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Headlines' }));
    expect(screen.getByTestId('library-layout-headlines')).toBeInTheDocument();
    expect(screen.getByText('ArcDrop Architecture Guide')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Moodboard' }));
    expect(screen.getByTestId('library-layout-moodboard')).toBeInTheDocument();
    expect(screen.getByText('MUI Design Tokens Reference')).toBeInTheDocument();
  });

  it('switches sort order and filters to unassigned view', async () => {
    const user = userEvent.setup();
    const seenQueries: Array<{ sort: string | null; unassignedOnly: string | null }> = [];

    server.use(
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const url = new URL(request.url);
        const sort = url.searchParams.get('sort');
        const unassignedOnly = url.searchParams.get('unassignedOnly');
        seenQueries.push({ sort, unassignedOnly });

        if (unassignedOnly === 'true') {
          return HttpResponse.json({
            items: [
              makeMockBookmark({
                id: 'bm-unassigned',
                title: 'Inbox Zero Article',
                url: 'https://example.test/inbox',
              }),
            ],
            totalCount: 1,
            page: 1,
            pageSize: 24,
          });
        }

        if (sort === 'title') {
          return HttpResponse.json({
            items: [
              makeMockBookmark({
                id: 'bm-alpha',
                title: 'Alpha Sorted Item',
                url: 'https://example.test/alpha',
              }),
            ],
            totalCount: 1,
            page: 1,
            pageSize: 24,
          });
        }

        return HttpResponse.json({
          items: [
            makeMockBookmark({
              id: 'bm-default',
              title: 'Default Updated Item',
              url: 'https://example.test/default',
            }),
          ],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        });
      }),
    );

    renderLibraryAt('/');

    expect(await screen.findByText('Default Updated Item')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
    await user.click(screen.getByRole('option', { name: 'Title (A–Z)' }));

    expect(await screen.findByText('Alpha Sorted Item')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Unassigned' }));
    expect(await screen.findByText('Inbox Zero Article')).toBeInTheDocument();
    expect(
      seenQueries.some((q) => q.sort === 'title') &&
        seenQueries.some((q) => q.unassignedOnly === 'true'),
    ).toBe(true);
  });

  it('supports load-more paging without duplicating existing items', async () => {
    const user = userEvent.setup();

    server.use(
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
        if (page === 1) {
          return HttpResponse.json({
            items: [makeMockBookmark({ id: 'bm-p1', title: 'Page One Bookmark' })],
            totalCount: 2,
            page: 1,
            pageSize: 1,
          });
        }
        return HttpResponse.json({
          items: [makeMockBookmark({ id: 'bm-p2', title: 'Page Two Bookmark' })],
          totalCount: 2,
          page: 2,
          pageSize: 1,
        });
      }),
    );

    renderLibraryAt('/');

    expect(await screen.findByText('Page One Bookmark')).toBeInTheDocument();
    const loadMoreBtn = screen.getByRole('button', { name: 'Load more' });
    await user.click(loadMoreBtn);

    expect(await screen.findByText('Page Two Bookmark')).toBeInTheDocument();
    expect(screen.getByText('Page One Bookmark')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('toggles favorite optimistically, reconciles with server & sync echo, and rolls back on failure', async () => {
    const user = userEvent.setup();
    let resolvePut!: () => void;
    let shouldFailNextPut = false;
    let currentFavorite = false;

    const targetBookmark = makeMockBookmark({
      id: 'bm-fav',
      title: 'Optimistic Star Bookmark',
      favorite: false,
    });

    server.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({
          items: [targetBookmark],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        }),
      ),
      http.put('*/api/v1/bookmarks/bm-fav', async ({ request }) => {
        if (shouldFailNextPut) {
          return problemJsonResponse(500, {
            code: 'INTERNAL_ERROR',
            title: 'Internal Error',
            detail: 'Simulated update error',
          });
        }
        const body = (await request.json()) as { favorite: boolean };
        await new Promise<void>((resolve) => {
          resolvePut = resolve;
        });
        currentFavorite = body.favorite;
        return HttpResponse.json(
          makeMockBookmark({
            id: 'bm-fav',
            title: 'Optimistic Star Bookmark',
            favorite: currentFavorite,
            updatedAt: '2026-11-14T04:00:00.000Z',
          }),
        );
      }),
      http.get('*/api/v1/sync/changes', () => {
        if (currentFavorite) {
          return HttpResponse.json({
            resyncRequired: false,
            cursor: '11',
            changes: [
              {
                seq: '11',
                entity: 'bookmark',
                id: 'bm-fav',
                action: 'update',
                snapshot: makeMockBookmark({
                  id: 'bm-fav',
                  title: 'Optimistic Star Bookmark',
                  favorite: true,
                  updatedAt: '2026-11-14T04:00:01.000Z',
                }),
              },
            ],
          });
        }
        return HttpResponse.json({ resyncRequired: false, changes: [], cursor: '10' });
      }),
    );

    renderLibraryAt('/');

    expect(await screen.findByText('Optimistic Star Bookmark')).toBeInTheDocument();
    const starButton = screen.getByRole('button', {
      name: 'Add to favorites: Optimistic Star Bookmark',
    });
    expect(starButton).toHaveAttribute('aria-pressed', 'false');

    // Click triggers optimistic state BEFORE PUT resolves
    await user.click(starButton);
    expect(
      screen.getByRole('button', { name: 'Remove from favorites: Optimistic Star Bookmark' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(useLibraryStore.getState().bookmarksById['bm-fav']?.favorite).toBe(true);

    // Resolve PUT & deliver WS sync echo
    resolvePut();
    await waitFor(() => {
      expect(useLibraryStore.getState().pendingOptimistic['bm-fav']).toBeUndefined();
    });

    testFakeWsController.latest?.simulateMessage({
      seq: '11',
      entity: 'bookmark',
      id: 'bm-fav',
      action: 'update',
    });
    await waitFor(() => {
      expect(useLibraryStore.getState().bookmarksById['bm-fav']?.updatedAt).toBe(
        '2026-11-14T04:00:01.000Z',
      );
    });

    // Now test failure rollback
    shouldFailNextPut = true;
    await user.click(
      screen.getByRole('button', { name: 'Remove from favorites: Optimistic Star Bookmark' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Simulated update error');
    expect(
      screen.getByRole('button', { name: 'Remove from favorites: Optimistic Star Bookmark' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
