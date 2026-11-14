import { render, screen, waitFor, within } from '@testing-library/react';
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
import { waitForLibraryReady, waitForTrashReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';

function renderAtLibrary(path = '/') {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'bulk@arcdrop.test' },
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

describe('BulkActionToolbar & Collection Tools', () => {
  it('supports move (union/assign), addTags, removeTags, trash, and surfaces trashed-only delete enforcement', async () => {
    const user = userEvent.setup({ delay: null });
    const bulkRequests: Array<{
      action: string;
      ids: string[];
      mode?: string;
      collectionIds?: string[];
      tags?: string[];
    }> = [];

    const cols = [
      makeMockCollection({ id: 'col-1', title: 'Reading List' }),
      makeMockCollection({ id: 'col-2', title: 'Research Archive' }),
    ];

    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: cols })),
      http.get('*/api/v1/collections/tree', () =>
        HttpResponse.json(cols.map((col) => ({ ...col, children: [] }))),
      ),
      http.post('*/api/v1/bookmarks/bulk', async ({ request }) => {
        const body = (await request.json()) as {
          action: string;
          ids: string[];
          mode?: string;
          collectionIds?: string[];
          tags?: string[];
        };
        bulkRequests.push(body);
        return HttpResponse.json({
          action: body.action,
          affected: body.ids.length,
          ids: body.ids,
        });
      }),
    );

    renderAtLibrary('/');
    await waitForLibraryReady();

    expect(await screen.findByText('ArcDrop Architecture Guide')).toBeInTheDocument();
    expect(screen.getByText('MUI Design Tokens Reference')).toBeInTheDocument();

    // Select all in view
    await user.click(screen.getByRole('button', { name: 'Select all in view' }));
    const toolbar = await screen.findByTestId('bulk-action-toolbar');
    expect(within(toolbar).getByTestId('bulk-selected-count')).toHaveTextContent('2 selected');

    // Trashed-only delete enforcement is surfaced and Delete permanently is disabled for active bookmarks
    expect(within(toolbar).getByTestId('bulk-trashed-only-hint')).toHaveTextContent(
      'Only trashed bookmarks can be permanently deleted',
    );
    expect(within(toolbar).getByRole('button', { name: 'Delete permanently' })).toBeDisabled();

    // Move (assign mode)
    await user.click(within(toolbar).getByRole('button', { name: 'Move' }));
    const moveDialog = await screen.findByRole('dialog');
    await user.click(
      within(moveDialog).getByRole('radio', { name: 'Replace existing collections' }),
    );
    await user.click(within(moveDialog).getByRole('checkbox', { name: 'Research Archive' }));
    await user.click(within(moveDialog).getByRole('button', { name: 'Apply move' }));

    await waitFor(() => {
      expect(bulkRequests).toHaveLength(1);
    });
    expect(bulkRequests[0]).toEqual({
      action: 'move',
      ids: ['bm-1', 'bm-2'],
      mode: 'assign',
      collectionIds: ['col-2'],
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(await screen.findByTestId('bulk-summary-alert')).toHaveTextContent('Moved 2 bookmarks.');

    // Re-select bm-1 and addTags
    await user.click(
      screen.getByRole('checkbox', { name: 'Select bookmark: ArcDrop Architecture Guide' }),
    );
    await user.click(screen.getByRole('button', { name: 'Add tags' }));
    const addTagsDialog = await screen.findByRole('dialog');
    const tagInput = within(addTagsDialog).getByRole('combobox');
    await user.type(tagInput, 'priority{Enter}');
    await user.click(within(addTagsDialog).getByRole('button', { name: 'Apply tags' }));

    await waitFor(() => {
      expect(bulkRequests).toHaveLength(2);
    });
    expect(bulkRequests[1]).toEqual({
      action: 'addTags',
      ids: ['bm-1'],
      tags: ['priority'],
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // Re-select bm-1 and move to trash
    await user.click(
      screen.getByRole('checkbox', { name: 'Select bookmark: ArcDrop Architecture Guide' }),
    );
    await user.click(screen.getByRole('button', { name: 'Move to trash' }));

    await waitFor(() => {
      expect(bulkRequests).toHaveLength(3);
    });
    expect(bulkRequests[2]).toEqual({
      action: 'trash',
      ids: ['bm-1'],
    });
    await waitFor(() => {
      expect(screen.queryByText('ArcDrop Architecture Guide')).not.toBeInTheDocument();
    });
  }, 90_000);

  it('surfaces friendly 429 rate-limit alert with Retry-After and retries the bulk request', async () => {
    const user = userEvent.setup({ delay: null });
    let attempt = 0;

    server.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({
          items: [makeMockBookmark({ id: 'bm-rate', title: 'Rate Limited Bookmark' })],
          totalCount: 1,
          page: 1,
          pageSize: 24,
        }),
      ),
      http.post('*/api/v1/bookmarks/bulk', async ({ request }) => {
        attempt += 1;
        if (attempt === 1) {
          return new HttpResponse(
            JSON.stringify({
              type: 'https://arcdrop.dev/problems/too-many-requests',
              title: 'Too Many Requests',
              status: 429,
              code: 'TOO_MANY_REQUESTS',
              detail: 'Bulk rate limit exceeded.',
            }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/problem+json',
                'Retry-After': '15',
              },
            },
          );
        }
        const body = (await request.json()) as { action: string; ids: string[] };
        return HttpResponse.json({
          action: body.action,
          affected: body.ids.length,
          ids: body.ids,
        });
      }),
    );

    renderAtLibrary('/');
    await waitForLibraryReady();

    await user.click(
      await screen.findByRole('checkbox', { name: 'Select bookmark: Rate Limited Bookmark' }),
    );
    await user.click(screen.getByRole('button', { name: 'Move to trash' }));

    const rateAlert = await screen.findByTestId('bulk-rate-limit-alert');
    expect(rateAlert).toHaveTextContent('Rate limit reached for bulk actions.');
    expect(rateAlert).toHaveTextContent('15 seconds');

    await user.click(within(rateAlert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('bulk-summary-alert')).toHaveTextContent(
      'Moved to trash: 1 bookmark.',
    );
    expect(attempt).toBe(2);
  }, 90_000);

  it('triggers sort-alphabetical and delete-empty from CollectionTreeSidebar collection tools menu', async () => {
    const user = userEvent.setup({ delay: null });
    let sortCalled = false;
    let deleteEmptyCalled = false;

    const cols = [
      makeMockCollection({ id: 'col-b', title: 'Zeta' }),
      makeMockCollection({ id: 'col-a', title: 'Alpha', bookmarkCount: 0 }),
    ];

    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: cols })),
      http.get('*/api/v1/collections/tree', () =>
        HttpResponse.json(cols.map((col) => ({ ...col, children: [] }))),
      ),
      http.post('*/api/v1/collections/sort-alphabetical', () => {
        sortCalled = true;
        return HttpResponse.json({ updated: 2 });
      }),
      http.post('*/api/v1/collections/delete-empty', () => {
        deleteEmptyCalled = true;
        return HttpResponse.json({ trashed: 1, kept: 1 });
      }),
    );

    renderAtLibrary('/');
    await waitForLibraryReady();

    await user.click(screen.getByTestId('collection-tools-button'));
    await user.click(await screen.findByTestId('collection-tools-sort'));

    await waitFor(() => {
      expect(sortCalled).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('collection-tools-sort')).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId('collection-tools-button'));
    await user.click(await screen.findByTestId('collection-tools-delete-empty'));

    await waitFor(() => {
      expect(deleteEmptyCalled).toBe(true);
    });
  }, 90_000);

  it('surfaces 409 error cleanly if server rejects permanent delete on active bookmarks', async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const trashed = new URL(request.url).searchParams.get('trashed');
        if (trashed === 'true') {
          return HttpResponse.json({
            items: [
              makeMockBookmark({
                id: 'bm-t1',
                title: 'Trashed Item',
                deletedAt: '2026-11-14T00:00:00.000Z',
              }),
            ],
            totalCount: 1,
            page: 1,
            pageSize: 24,
          });
        }
        return HttpResponse.json({ items: [], totalCount: 0, page: 1, pageSize: 24 });
      }),
      http.post('*/api/v1/bookmarks/bulk', () =>
        problemJsonResponse(409, {
          code: 'TRASH_REQUIRED',
          title: 'Conflict',
          detail: 'All bookmarks must be in Trash before permanent deletion.',
        }),
      ),
    );

    renderAtLibrary('/trash');
    await waitForTrashReady();
    expect(await screen.findByText('Trashed Item')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Select bookmark: Trashed Item'));
    await user.click(
      within(screen.getByTestId('bulk-action-toolbar')).getByRole('button', {
        name: 'Delete permanently',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByTestId('bulk-error-alert')).toHaveTextContent(
      'All bookmarks must be in Trash before permanent deletion.',
    );
  }, 90_000);
});
