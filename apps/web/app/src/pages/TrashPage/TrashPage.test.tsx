import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import { makeMockBookmark, makeMockSession, makeMockSettings } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { waitForTrashReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';

function renderTrash(role: 'admin' | 'user' = 'admin') {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: `${role}@arcdrop.test`, role },
    }),
  );

  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/trash'],
  });

  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('TrashPage', () => {
  it('shows retention note from settings, restores individual item, and purges individual item', async () => {
    const user = userEvent.setup({ delay: null });
    const restoredIds: string[] = [];
    const deletedBatches: string[][] = [];

    server.use(
      http.get('*/api/v1/admin/settings', () =>
        HttpResponse.json(makeMockSettings({ trashRetentionDays: 45 })),
      ),
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const trashed = new URL(request.url).searchParams.get('trashed');
        if (trashed === 'true') {
          return HttpResponse.json({
            items: [
              makeMockBookmark({
                id: 'bm-trash-1',
                title: 'Trashed Alpha',
                deletedAt: '2026-11-12T00:00:00.000Z',
              }),
              makeMockBookmark({
                id: 'bm-trash-2',
                title: 'Trashed Beta',
                deletedAt: '2026-11-13T00:00:00.000Z',
              }),
            ],
            totalCount: 2,
            page: 1,
            pageSize: 24,
          });
        }
        return HttpResponse.json({ items: [], totalCount: 0, page: 1, pageSize: 24 });
      }),
      http.post('*/api/v1/bookmarks/:id/restore', ({ params }) => {
        const id = String(params.id);
        restoredIds.push(id);
        return HttpResponse.json(
          makeMockBookmark({ id, title: 'Trashed Alpha', deletedAt: null }),
        );
      }),
      http.post('*/api/v1/bookmarks/bulk', async ({ request }) => {
        const body = (await request.json()) as { action: string; ids: string[] };
        if (body.action === 'delete') {
          deletedBatches.push(body.ids);
        }
        return HttpResponse.json({
          action: body.action,
          affected: body.ids.length,
          ids: body.ids,
        });
      }),
    );

    renderTrash('admin');
    await waitForTrashReady();

    expect(await screen.findByTestId('trash-retention-note')).toHaveTextContent(
      'Trashed items are kept for 45 days',
    );
    expect(await screen.findByText('Trashed Alpha')).toBeInTheDocument();
    expect(screen.getByText('Trashed Beta')).toBeInTheDocument();

    // Restore Trashed Alpha
    await user.click(screen.getByRole('button', { name: 'Restore: Trashed Alpha' }));
    await waitFor(() => {
      expect(restoredIds).toEqual(['bm-trash-1']);
      expect(screen.queryByText('Trashed Alpha')).not.toBeInTheDocument();
    });

    // Purge Trashed Beta
    await user.click(screen.getByRole('button', { name: 'Purge: Trashed Beta' }));
    await waitFor(() => {
      expect(deletedBatches).toEqual([['bm-trash-2']]);
      expect(screen.queryByText('Trashed Beta')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Trash is empty')).toBeInTheDocument();
  }, 60_000);

  it('supports purge-all with confirmation dialog and default retention note for non-admins', async () => {
    const user = userEvent.setup({ delay: null });
    const deletedBatches: string[][] = [];

    server.use(
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const trashed = new URL(request.url).searchParams.get('trashed');
        if (trashed === 'true') {
          return HttpResponse.json({
            items: [
              makeMockBookmark({
                id: 'bm-t-a',
                title: 'Old Note A',
                deletedAt: '2026-11-10T00:00:00.000Z',
              }),
              makeMockBookmark({
                id: 'bm-t-b',
                title: 'Old Note B',
                deletedAt: '2026-11-11T00:00:00.000Z',
              }),
            ],
            totalCount: 2,
            page: 1,
            pageSize: 24,
          });
        }
        return HttpResponse.json({ items: [], totalCount: 0, page: 1, pageSize: 24 });
      }),
      http.post('*/api/v1/bookmarks/bulk', async ({ request }) => {
        const body = (await request.json()) as { action: string; ids: string[] };
        if (body.action === 'delete') {
          deletedBatches.push(body.ids);
        }
        return HttpResponse.json({
          action: body.action,
          affected: body.ids.length,
          ids: body.ids,
        });
      }),
    );

    renderTrash('user');
    await waitForTrashReady();

    expect(await screen.findByTestId('trash-retention-note')).toHaveTextContent(
      'Trashed items are kept for 30 days',
    );
    expect(await screen.findByText('Old Note A')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Purge all' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Purge all trashed bookmarks?')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Purge all permanently' }));

    await waitFor(() => {
      expect(deletedBatches).toEqual([['bm-t-a', 'bm-t-b']]);
    });
    expect(await screen.findByText('Trash is empty')).toBeInTheDocument();
  }, 60_000);
});
