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
  makeMockDuplicateGroup,
  makeMockSession,
  makeMockSettings,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { testFakeWsController } from '../../test/setup';
import { waitForHealthReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';

function renderHealth(role: 'admin' | 'user' = 'admin') {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: `${role}@arcdrop.test`, role },
    }),
  );

  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/health'],
  });

  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('HealthPage', () => {
  it('renders duplicate groups side-by-side with merged tags preview and resolves duplicates', async () => {
    const user = userEvent.setup({ delay: null });
    const resolveCalls: Array<{ keepId: string; trashIds: string[] }> = [];

    const group = makeMockDuplicateGroup({
      normalizedUrl: 'arcdrop.test/docs/guide',
      original: makeMockBookmark({
        id: 'bm-orig',
        title: 'Guide Original',
        url: 'https://arcdrop.test/docs/guide',
        tags: [{ id: 't1', name: 'architecture' }],
      }),
      extras: [
        makeMockBookmark({
          id: 'bm-extra-1',
          title: 'Guide Copy A',
          url: 'https://www.arcdrop.test/docs/guide?utm_source=rss',
          tags: [{ id: 't2', name: 'sync' }],
        }),
      ],
    });

    server.use(
      http.get('*/api/v1/library/duplicates', () => HttpResponse.json({ groups: [group] })),
      http.post('*/api/v1/library/duplicates/resolve', async ({ request }) => {
        const body = (await request.json()) as { keepId: string; trashIds: string[] };
        resolveCalls.push(body);
        return HttpResponse.json({
          kept: makeMockBookmark({
            id: body.keepId,
            title: 'Guide Original',
            tags: [
              { id: 't1', name: 'architecture' },
              { id: 't2', name: 'sync' },
            ],
          }),
          trashedIds: body.trashIds,
        });
      }),
    );

    renderHealth('admin');
    await waitForHealthReady();

    expect(await screen.findByText('arcdrop.test/docs/guide')).toBeInTheDocument();
    expect(screen.getByTestId('dup-candidate-bm-orig')).toBeInTheDocument();
    expect(screen.getByTestId('dup-candidate-bm-extra-1')).toBeInTheDocument();

    // Preview shows union of tags from kept + trashed extras
    const preview = screen.getByTestId('dup-preview-arcdrop.test/docs/guide');
    expect(within(preview).getByText('#architecture')).toBeInTheDocument();
    expect(within(preview).getByText('#sync')).toBeInTheDocument();
    expect(
      within(preview).getByText(/Collection memberships from the selected extras/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resolve group' }));

    await waitFor(() => {
      expect(resolveCalls).toEqual([{ keepId: 'bm-orig', trashIds: ['bm-extra-1'] }]);
    });

    expect(await screen.findByTestId('health-resolved-alert')).toHaveTextContent(
      'Resolved duplicate group: "Guide Original" kept, moved 1 to trash.',
    );
    expect(await screen.findByTestId('duplicates-empty')).toBeInTheDocument();
  }, 60_000);

  it('displays broken links with reasons, admin settings check mode, and recheck reindex trigger', async () => {
    const user = userEvent.setup({ delay: null });
    const reindexedIds: string[] = [];

    server.use(
      http.get('*/api/v1/admin/settings', () =>
        HttpResponse.json(makeMockSettings({ brokenLinkCheckMode: 'strict' })),
      ),
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const broken = new URL(request.url).searchParams.get('broken');
        if (broken === 'true') {
          return HttpResponse.json({
            items: [
              makeMockBookmark({
                id: 'bm-broken-1',
                title: 'Dead Docs Link',
                url: 'https://arcdrop.test/404',
                brokenReason: 'HTTP 404 Not Found',
                brokenAt: '2026-11-13T10:00:00.000Z',
                lastCheckedAt: '2026-11-14T01:00:00.000Z',
                cacheStatus: 'failed',
              }),
            ],
            totalCount: 1,
            page: 1,
            pageSize: 100,
          });
        }
        return HttpResponse.json({ items: [], totalCount: 0, page: 1, pageSize: 24 });
      }),
      http.post('*/api/v1/bookmarks/:id/reindex', ({ params }) => {
        const id = String(params.id);
        reindexedIds.push(id);
        return HttpResponse.json({ id, status: 'scheduled' as const }, { status: 202 });
      }),
    );

    renderHealth('admin');
    await waitForHealthReady();

    await user.click(screen.getByRole('tab', { name: /Broken links/i }));

    const modeNote = await screen.findByTestId('broken-links-mode-note');
    expect(modeNote).toHaveTextContent('Broken link check mode: strict');

    const row = await screen.findByTestId('broken-bookmark-bm-broken-1');
    expect(within(row).getByText('Dead Docs Link')).toBeInTheDocument();
    expect(within(row).getByText('Reason: HTTP 404 Not Found')).toBeInTheDocument();
    expect(within(row).getByTestId('cache-status-chip-failed')).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Recheck: Dead Docs Link' }));

    await waitFor(() => {
      expect(reindexedIds).toEqual(['bm-broken-1']);
    });
    expect(await within(row).findByTestId('cache-status-chip-pending')).toBeInTheDocument();
  }, 60_000);

  it('refreshes health data when sync events advance the cursor', async () => {
    let dupCallCount = 0;
    let allowSyncAdvance = false;

    server.use(
      http.get('*/api/v1/library/duplicates', () => {
        dupCallCount += 1;
        if (dupCallCount === 1) {
          return HttpResponse.json({ groups: [] });
        }
        return HttpResponse.json({
          groups: [makeMockDuplicateGroup({ normalizedUrl: 'arcdrop.test/newly-detected' })],
        });
      }),
      http.get('*/api/v1/sync/changes', () =>
        HttpResponse.json({
          resyncRequired: false,
          cursor: allowSyncAdvance ? '15' : '10',
          changes: [],
        }),
      ),
    );

    renderHealth('user');
    await waitForHealthReady();
    expect(await screen.findByTestId('duplicates-empty')).toBeInTheDocument();

    allowSyncAdvance = true;
    testFakeWsController.latest?.simulateMessage({
      seq: '15',
      entity: 'bookmark',
      id: 'bm-new',
      action: 'create',
    });

    expect(await screen.findByText('arcdrop.test/newly-detected')).toBeInTheDocument();
    expect(dupCallCount).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
