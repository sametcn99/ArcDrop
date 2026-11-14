import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import {
  makeMockBookmark,
  makeMockCollection,
  makeMockSession,
  problemJsonResponse,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { waitForCollectionReady, waitForLibraryReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';

function renderAppAt(path = '/') {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'reader@arcdrop.test' },
    }),
  );

  const router = createMemoryRouter(appRoutes, {
    initialEntries: [path],
  });

  const utils = render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );

  return { ...utils, router };
}

describe('W5 — Search & filters integration', () => {
  it('sends exact API query params for M11 search grammar and syncs with URL', async () => {
    const user = userEvent.setup({ delay: null });
    const capturedQueries: Array<Record<string, string | null>> = [];

    server.use(
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const url = new URL(request.url);
        capturedQueries.push({
          search: url.searchParams.get('search'),
          type: url.searchParams.get('type'),
          tag: url.searchParams.get('tag'),
        });

        return HttpResponse.json({
          items: [
            makeMockBookmark({
              id: 'bm-match',
              title: 'Operator Search Match',
              contentType: 'video',
              favorite: true,
              tags: [{ id: 'tag-1', name: 'architecture' }],
            }),
          ],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        });
      }),
    );

    const { router } = renderAppAt('/');
    await waitForLibraryReady();

    const searchInput = screen.getByRole('textbox', { name: 'Search bookmarks' });
    await user.click(searchInput);
    await user.paste('#architecture -spam type:video created:>=2026-01-01 match:OR');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(
        capturedQueries.some(
          (q) => q.search === '#architecture -spam type:video created:>=2026-01-01 match:OR',
        ),
      ).toBe(true);
    });
    expect(new URLSearchParams(router.state.location.search).get('search')).toBe(
      '#architecture -spam type:video created:>=2026-01-01 match:OR',
    );
  }, 60_000);

  it('composes FilterChipsBar add/remove for all filter controls with URL state and API params', async () => {
    const user = userEvent.setup({ delay: null });
    const capturedQueries: Array<Record<string, string | null>> = [];

    server.use(
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const url = new URL(request.url);
        capturedQueries.push({
          search: url.searchParams.get('search'),
          type: url.searchParams.get('type'),
          tag: url.searchParams.get('tag'),
          favorite: url.searchParams.get('favorite'),
          broken: url.searchParams.get('broken'),
          file: url.searchParams.get('file'),
        });

        return HttpResponse.json({
          items: [
            makeMockBookmark({
              id: 'bm-match',
              title: 'Filtered Match',
              contentType: 'video',
              favorite: true,
              tags: [{ id: 'tag-1', name: 'architecture' }],
            }),
          ],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        });
      }),
    );

    const { router } = renderAppAt('/');
    await waitForLibraryReady();

    // Type select -> Video
    await user.click(screen.getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'Video' }));
    expect(await screen.findByTestId('filter-chip-type')).toHaveTextContent('Type: video');

    // Tag autocomplete -> pick 'design', then pick 'architecture'
    const tagCombo = screen.getByRole('combobox', { name: 'Tag filter' });
    await user.type(tagCombo, 'des');
    await user.click(await screen.findByRole('option', { name: 'design' }));
    expect(await screen.findByTestId('filter-chip-tag-design')).toHaveTextContent('#design');

    await user.type(tagCombo, 'arch');
    await user.click(await screen.findByRole('option', { name: 'architecture' }));
    expect(await screen.findByTestId('filter-chip-tag-architecture')).toHaveTextContent(
      '#architecture',
    );

    // Boolean toggles: Favorite, No tags, Broken, Files, match:OR
    await user.click(screen.getByRole('button', { name: 'Favorite' }));
    await user.click(screen.getByRole('button', { name: 'No tags' }));
    await user.click(screen.getByRole('button', { name: 'Broken' }));
    await user.click(screen.getByRole('button', { name: 'Files' }));
    await user.click(screen.getByRole('button', { name: 'match:OR' }));

    // Created date range popover
    await user.click(screen.getByRole('button', { name: 'Created date' }));
    const fromInput = await screen.findByLabelText('From');
    const toInput = screen.getByLabelText('To');
    fireEvent.change(fromInput, { target: { value: '2026-01-01' } });
    fireEvent.change(toInput, { target: { value: '2026-12-31' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByTestId('filter-chip-created')).toHaveTextContent(
      'Created: 2026-01-01 – 2026-12-31',
    );

    await waitFor(() => {
      expect(
        capturedQueries.some(
          (q) =>
            q.type === 'video' &&
            q.favorite === 'true' &&
            q.broken === 'true' &&
            q.file === 'true' &&
            q.search ===
              'match:OR #design #architecture notag:true created:>=2026-01-01 created:<=2026-12-31',
        ),
      ).toBe(true);
    });

    // Verify URL params match chips
    const activeParams = new URLSearchParams(router.state.location.search);
    expect(activeParams.get('type')).toBe('video');
    expect(activeParams.getAll('tag')).toEqual(['design', 'architecture']);
    expect(activeParams.get('favorite')).toBe('true');
    expect(activeParams.get('notag')).toBe('true');
    expect(activeParams.get('broken')).toBe('true');
    expect(activeParams.get('file')).toBe('true');
    expect(activeParams.get('createdFrom')).toBe('2026-01-01');
    expect(activeParams.get('createdTo')).toBe('2026-12-31');
    expect(activeParams.get('match')).toBe('OR');

    // Remove individual chips
    await user.click(screen.getByLabelText('Remove #design'));
    await waitFor(() => {
      expect(screen.queryByTestId('filter-chip-tag-design')).not.toBeInTheDocument();
    });
    // Single remaining tag 'architecture' maps to REST `tag=architecture`
    await waitFor(() => {
      expect(
        capturedQueries.some(
          (q) =>
            q.tag === 'architecture' &&
            q.type === 'video' &&
            q.search === 'match:OR notag:true created:>=2026-01-01 created:<=2026-12-31',
        ),
      ).toBe(true);
    });

    // Click Clear filters
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      expect(screen.queryByTestId('active-filter-chips')).not.toBeInTheDocument();
    });
    expect(router.state.location.search).toBe('');
  }, 60_000);

  it('toggles tag filter chip when clicking a tag chip on a bookmark card', async () => {
    const user = userEvent.setup({ delay: null });
    const seenTags: Array<string | null> = [];

    server.use(
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const url = new URL(request.url);
        seenTags.push(url.searchParams.get('tag'));
        return HttpResponse.json({
          items: [
            makeMockBookmark({
              id: 'bm-1',
              title: 'ArcDrop Architecture Guide',
              tags: [{ id: 'tag-1', name: 'architecture' }],
            }),
          ],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        });
      }),
    );

    renderAppAt('/');
    await waitForLibraryReady();

    const card = await screen.findByTestId('bookmark-item-bm-1');
    await user.click(within(card).getByRole('button', { name: '#architecture' }));

    expect(await screen.findByTestId('filter-chip-tag-architecture')).toBeInTheDocument();
    await waitFor(() => {
      expect(seenTags.includes('architecture')).toBe(true);
    });
  }, 60_000);

  it('handles HTTP 400 reserved-operator errors inline without crashing sync and clears on valid query', async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search') ?? '';
        if (search.includes('before:')) {
          return problemJsonResponse(400, {
            code: 'RESERVED_OPERATOR',
            title: 'Invalid search query',
            detail: 'Operator "before:" is reserved and not available yet.',
          });
        }
        return HttpResponse.json({
          items: [
            makeMockBookmark({
              id: 'bm-ok',
              title: 'Recovered Search Result',
            }),
          ],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        });
      }),
    );

    renderAppAt('/');
    await waitForLibraryReady();

    const searchInput = screen.getByRole('textbox', { name: 'Search bookmarks' });
    await user.click(searchInput);
    await user.paste('before:2026-01-01');
    await user.keyboard('{Enter}');

    const inlineError = await screen.findByTestId('search-inline-error');
    expect(inlineError).toHaveTextContent('Operator "before:" is reserved and not available yet.');
    expect(inlineError).toHaveTextContent('Open the syntax cheatsheet (?)');
    expect(screen.getByTestId('sync-status-indicator')).toHaveAttribute('data-sync-state', 'live');

    // Recover by replacing query with a valid search
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await user.paste('guide');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByTestId('search-inline-error')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Recovered Search Result')).toBeInTheDocument();
  }, 60_000);

  it('restores shared URL state (filters, search, view, sort, layout) and supports back/forward navigation', async () => {
    const capturedUrls: string[] = [];

    server.use(
      http.get('*/api/v1/bookmarks', ({ request }) => {
        capturedUrls.push(request.url);
        return HttpResponse.json({
          items: [
            makeMockBookmark({
              id: 'bm-shared',
              title: 'Shared Filter Bookmark',
              contentType: 'video',
            }),
          ],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        });
      }),
    );

    const sharedUrl =
      '/?search=-spam&type=video&tag=architecture&tag=sync&favorite=true&notag=true&broken=true&file=true&createdFrom=2026-01-01&createdTo=2026-12-31&match=OR&view=unassigned&sort=title&layout=grid';

    const { router } = renderAppAt(sharedUrl);
    await waitForLibraryReady();

    expect(screen.getByRole('textbox', { name: 'Search bookmarks' })).toHaveValue('-spam');
    expect(screen.getByTestId('filter-chip-type')).toHaveTextContent('Type: video');
    expect(screen.getByTestId('filter-chip-tag-architecture')).toHaveTextContent('#architecture');
    expect(screen.getByTestId('filter-chip-tag-sync')).toHaveTextContent('#sync');
    expect(screen.getByTestId('filter-chip-favorite')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-notag')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-broken')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-file')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-created')).toHaveTextContent(
      'Created: 2026-01-01 – 2026-12-31',
    );
    expect(screen.getByTestId('filter-chip-match-or')).toBeInTheDocument();
    expect(screen.getByTestId('library-layout-grid')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Unassigned' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await waitFor(() => {
      const matched = capturedUrls.some((rawUrl) => {
        const params = new URL(rawUrl).searchParams;
        return (
          params.get('unassignedOnly') === 'true' &&
          params.get('sort') === 'title' &&
          params.get('type') === 'video' &&
          params.get('favorite') === 'true' &&
          params.get('broken') === 'true' &&
          params.get('file') === 'true' &&
          params.get('search') ===
            'match:OR -spam #architecture #sync notag:true created:>=2026-01-01 created:<=2026-12-31'
        );
      });
      expect(matched).toBe(true);
    });

    // Navigate forward to a simpler query, then Back to restore full filter state
    await act(async () => {
      await router.navigate('/?type=article');
    });
    expect(await screen.findByTestId('filter-chip-type')).toHaveTextContent('Type: article');
    expect(screen.queryByTestId('filter-chip-match-or')).not.toBeInTheDocument();

    await act(async () => {
      await router.navigate(-1);
    });
    expect(await screen.findByTestId('filter-chip-match-or')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search bookmarks' })).toHaveValue('-spam');
  }, 60_000);

  it('composes filters AND with collectionId on CollectionPage and shows SearchEmptyState with grammar hints when 0 match', async () => {
    const user = userEvent.setup({ delay: null });
    const collectionQueries: Array<{
      collectionId: string | null;
      search: string | null;
      type: string | null;
      favorite: string | null;
    }> = [];

    server.use(
      http.get('*/api/v1/collections', () =>
        HttpResponse.json({
          items: [makeMockCollection({ id: 'col-1', title: 'Engineering', bookmarkCount: 2 })],
        }),
      ),
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search');
        const type = url.searchParams.get('type');
        const favorite = url.searchParams.get('favorite');
        collectionQueries.push({
          collectionId: url.searchParams.get('collectionId'),
          search,
          type,
          favorite,
        });

        if (search?.includes('no-results')) {
          return HttpResponse.json({
            items: [],
            totalCount: 0,
            page: 1,
            pageSize: 24,
          });
        }

        return HttpResponse.json({
          items: [makeMockBookmark({ id: 'bm-col', title: 'Collection Filtered Item' })],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        });
      }),
    );

    renderAppAt('/collections/col-1?type=article&favorite=true&search=no-results');
    await waitForCollectionReady();

    expect(
      collectionQueries.some(
        (q) =>
          q.collectionId === 'col-1' &&
          q.type === 'article' &&
          q.favorite === 'true' &&
          q.search === 'no-results',
      ),
    ).toBe(true);

    const emptyState = await screen.findByTestId('search-empty-state');
    expect(emptyState).toHaveTextContent('No bookmarks match your search');
    expect(emptyState).toHaveTextContent('match:OR');
    expect(emptyState).toHaveTextContent('-exclude');

    await user.click(within(emptyState).getByRole('button', { name: 'Clear search & filters' }));
    expect(await screen.findByText('Collection Filtered Item')).toBeInTheDocument();
  }, 60_000);
});
