import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Collection } from '../../api/schemas/collections';
import { appRoutes } from '../../app/routes';
import { useAuthStore } from '../../stores/authStore';
import {
  makeDefaultBookmarkFixtures,
  makeMockCollection,
  makeMockSession,
  problemJsonResponse,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';
import { SHARED_COLLECTION_STRINGS } from '../strings';
import { SnackbarHost } from './SnackbarHost';

function renderShellAt(path = '/') {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'merge@arcdrop.test' },
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

function makeFixtureTree(): Collection[] {
  return [
    makeMockCollection({
      id: 'col-1',
      parentId: null,
      title: 'Reading List',
      order: 0,
      bookmarkCount: 2,
    }),
    makeMockCollection({
      id: 'col-2',
      parentId: 'col-1',
      title: 'Architecture',
      order: 0,
      bookmarkCount: 1,
    }),
    makeMockCollection({
      id: 'col-4',
      parentId: null,
      title: 'Design Systems',
      order: 1,
      bookmarkCount: 3,
    }),
  ];
}

function buildTreeNodes(items: Collection[]) {
  const byId = new Map<string, Collection & { children: Collection[] }>();
  for (const col of items) {
    byId.set(col.id, { ...col, children: [] });
  }
  const roots: Array<Collection & { children: Collection[] }> = [];
  for (const col of items) {
    const node = byId.get(col.id);
    if (!node) continue;
    const parent = col.parentId ? byId.get(col.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

describe('CollectionMergeDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates merge target, surfaces descendant-409 conflict, and shows merge summary', async () => {
    const user = userEvent.setup({ delay: null });
    let tree = makeFixtureTree();

    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: tree })),
      http.get('*/api/v1/collections/tree', () => HttpResponse.json(buildTreeNodes(tree))),
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({
          items: makeDefaultBookmarkFixtures(),
          totalCount: 2,
          page: 1,
          pageSize: 24,
        }),
      ),
      http.post('*/api/v1/collections/merge', async ({ request }) => {
        const body = (await request.json()) as { sourceIds: string[]; targetId: string };
        if (body.sourceIds.includes('col-1') && body.targetId === 'col-2') {
          return problemJsonResponse(409, {
            code: 'COLLECTION_DESCENDANT_TARGET',
            title: 'Conflict',
            detail: 'Target collection cannot be a descendant of a source collection.',
          });
        }
        const target =
          tree.find((c) => c.id === body.targetId) ?? makeMockCollection({ id: body.targetId });
        const updatedTarget = { ...target, bookmarkCount: target.bookmarkCount + 3 };
        tree = tree
          .filter((c) => !body.sourceIds.includes(c.id))
          .map((c) => (c.id === updatedTarget.id ? updatedTarget : c));
        return HttpResponse.json({
          target: updatedTarget,
          trashedIds: body.sourceIds,
          movedChildren: 1,
          movedBookmarks: 3,
        });
      }),
    );

    renderShellAt('/');
    expect(await screen.findByText('Design Systems')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: SHARED_COLLECTION_STRINGS.mergeCollectionsAriaLabel }),
    );
    const dialog = await screen.findByRole('dialog');

    // Validation: target cannot also be in sources
    await user.click(within(dialog).getByLabelText('Source collections: Reading List'));
    await user.click(
      within(dialog).getByRole('combobox', { name: SHARED_COLLECTION_STRINGS.mergeTargetLabel }),
    );
    await user.click(await screen.findByRole('option', { name: 'Reading List' }));
    await user.click(
      within(dialog).getByRole('button', { name: SHARED_COLLECTION_STRINGS.mergeSubmit }),
    );

    expect(
      await within(dialog).findByText(SHARED_COLLECTION_STRINGS.mergeValidationOverlap),
    ).toBeInTheDocument();

    // Descendant-409 from API
    await user.click(
      within(dialog).getByRole('combobox', { name: SHARED_COLLECTION_STRINGS.mergeTargetLabel }),
    );
    await user.click(await screen.findByRole('option', { name: 'Architecture' }));
    await user.click(
      within(dialog).getByRole('button', { name: SHARED_COLLECTION_STRINGS.mergeSubmit }),
    );

    expect(
      await within(dialog).findByText(
        'Target collection cannot be a descendant of a source collection.',
      ),
    ).toBeInTheDocument();

    // Valid merge: merge Design Systems (col-4) into Reading List (col-1)
    await user.click(within(dialog).getByLabelText('Source collections: Reading List'));
    await user.click(within(dialog).getByLabelText('Source collections: Design Systems'));
    await user.click(
      within(dialog).getByRole('combobox', { name: SHARED_COLLECTION_STRINGS.mergeTargetLabel }),
    );
    await user.click(await screen.findByRole('option', { name: 'Reading List' }));
    await user.click(
      within(dialog).getByRole('button', { name: SHARED_COLLECTION_STRINGS.mergeSubmit }),
    );

    expect(
      await within(dialog).findByText(SHARED_COLLECTION_STRINGS.mergeSummaryTitle),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('3')).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: SHARED_COLLECTION_STRINGS.mergeDone }),
    );

    expect(screen.queryByText('Design Systems')).not.toBeInTheDocument();
  });
});
