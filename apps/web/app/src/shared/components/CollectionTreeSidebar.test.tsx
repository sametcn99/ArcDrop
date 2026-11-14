import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Collection } from '../../api/schemas/collections';
import { appRoutes } from '../../app/routes';
import { useAuthStore } from '../../stores/authStore';
import { makeMockCollection, makeMockSession, problemJsonResponse } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { testFakeWsController } from '../../test/setup';
import { ThemeController } from '../../theme/ThemeController';
import { SHARED_COLLECTION_STRINGS } from '../strings';
import { SnackbarHost } from './SnackbarHost';

function renderShellAt(path = '/') {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'collections@arcdrop.test' },
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
      id: 'col-3',
      parentId: 'col-2',
      title: 'Sync Protocol',
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

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;

  constructor(type: string, params: PointerEventInit = {}) {
    super(type, { bubbles: true, cancelable: true, ...params });
    this.pointerId = params.pointerId ?? 1;
    this.pointerType = params.pointerType ?? 'mouse';
    this.isPrimary = params.isPrimary ?? true;
  }
}

async function performPointerDrag(
  activator: HTMLElement,
  startPoint: { x: number; y: number },
  getTargetPoint: () => { x: number; y: number },
) {
  await act(async () => {
    activator.dispatchEvent(
      new TestPointerEvent('pointerdown', {
        button: 0,
        buttons: 1,
        clientX: startPoint.x,
        clientY: startPoint.y,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  });

  await act(async () => {
    document.dispatchEvent(
      new TestPointerEvent('pointermove', {
        button: 0,
        buttons: 1,
        clientX: startPoint.x + 12,
        clientY: startPoint.y + 12,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  });

  const targetPoint = getTargetPoint();

  await act(async () => {
    document.dispatchEvent(
      new TestPointerEvent('pointermove', {
        button: 0,
        buttons: 1,
        clientX: targetPoint.x,
        clientY: targetPoint.y,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  });

  await act(async () => {
    document.dispatchEvent(
      new TestPointerEvent('pointerup', {
        button: 0,
        buttons: 0,
        clientX: targetPoint.x,
        clientY: targetPoint.y,
        pointerId: 1,
        isPrimary: true,
      }),
    );
  });
}

describe('CollectionTreeSidebar', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nested collection tree and persists expand/collapse state without writing on mount', async () => {
    const user = userEvent.setup({ delay: null });
    const tree = makeFixtureTree();

    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: tree })),
      http.get('*/api/v1/collections/tree', () => HttpResponse.json(buildTreeNodes(tree))),
    );

    const view = renderShellAt('/');

    expect(await screen.findByText('Reading List')).toBeInTheDocument();
    expect(screen.getByText('Design Systems')).toBeInTheDocument();
    expect(screen.queryByText('Architecture')).not.toBeInTheDocument();
    expect(localStorage.getItem('arcdrop.collectionTree.expanded')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Expand collection: Reading List' }));
    expect(await screen.findByText('Architecture')).toBeInTheDocument();

    const stored = JSON.parse(
      localStorage.getItem('arcdrop.collectionTree.expanded') ?? '{}',
    ) as Record<string, boolean>;
    expect(stored['col-1']).toBe(true);

    // Remount and confirm persisted expanded state restores automatically
    view.unmount();
    renderShellAt('/');
    expect(await screen.findByText('Architecture')).toBeInTheDocument();
  });

  it('supports tree CRUD, surfaces cycle-conflict 409 errors, and reconciles WS deltas', async () => {
    const user = userEvent.setup({ delay: null });
    let collections = makeFixtureTree();

    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: collections })),
      http.get('*/api/v1/collections/tree', () => HttpResponse.json(buildTreeNodes(collections))),
      http.post('*/api/v1/collections', async ({ request }) => {
        const body = (await request.json()) as {
          title: string;
          parentId?: string | null;
          icon?: string;
          color?: string;
        };
        const created = makeMockCollection({
          id: `col-${collections.length + 1}`,
          title: body.title,
          parentId: body.parentId ?? null,
          icon: body.icon ?? null,
          color: body.color ?? null,
          order: collections.length,
          bookmarkCount: 0,
        });
        collections = [...collections, created];
        return HttpResponse.json(created, { status: 201 });
      }),
      http.put('*/api/v1/collections/:id', async ({ params, request }) => {
        const id = String(params.id);
        const body = (await request.json()) as {
          title?: string;
          parentId?: string | null;
          icon?: string | null;
          color?: string | null;
        };
        if (id === 'col-1' && body.parentId === 'col-2') {
          return problemJsonResponse(409, {
            code: 'COLLECTION_CYCLE',
            title: 'Conflict',
            detail: 'Cannot move a collection inside its own descendant.',
          });
        }
        const existing = collections.find((c) => c.id === id) ?? makeMockCollection({ id });
        const updated: Collection = {
          ...existing,
          ...body,
          updatedAt: '2026-11-14T05:00:00.000Z',
        };
        collections = collections.map((c) => (c.id === id ? updated : c));
        return HttpResponse.json(updated);
      }),
    );

    renderShellAt('/');
    expect(await screen.findByText('Reading List')).toBeInTheDocument();

    // Create root collection with icon and color
    await user.click(
      screen.getByRole('button', { name: SHARED_COLLECTION_STRINGS.newCollectionAriaLabel }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Title/i), 'Research Vault');
    await user.click(within(dialog).getByRole('button', { name: 'Ideas' }));
    await user.click(within(dialog).getByRole('button', { name: 'Color: Primary' }));
    await user.click(
      within(dialog).getByRole('button', { name: SHARED_COLLECTION_STRINGS.formCreateSubmit }),
    );

    expect(await screen.findByText('Research Vault')).toBeInTheDocument();

    // Context menu -> Add sub-collection
    await user.click(screen.getByRole('button', { name: 'Collection actions: Reading List' }));
    await user.click(
      await screen.findByRole('menuitem', { name: SHARED_COLLECTION_STRINGS.menuAddChild }),
    );
    const childDialog = await screen.findByRole('dialog');
    await user.type(within(childDialog).getByLabelText(/Title/i), 'Papers');
    await user.click(
      within(childDialog).getByRole('button', {
        name: SHARED_COLLECTION_STRINGS.formCreateSubmit,
      }),
    );

    expect(await screen.findByText('Papers')).toBeInTheDocument();
    expect(screen.getByText('Architecture')).toBeInTheDocument();

    // Edit collection and trigger cycle-conflict 409
    await user.click(screen.getByRole('button', { name: 'Collection actions: Reading List' }));
    await user.click(
      await screen.findByRole('menuitem', { name: SHARED_COLLECTION_STRINGS.menuEdit }),
    );
    const editDialog = await screen.findByRole('dialog');
    await user.click(
      within(editDialog).getByRole('combobox', {
        name: SHARED_COLLECTION_STRINGS.formParentLabel,
      }),
    );
    await user.click(await screen.findByRole('option', { name: 'Architecture' }));
    await user.click(
      within(editDialog).getByRole('button', { name: SHARED_COLLECTION_STRINGS.formSaveSubmit }),
    );

    expect(
      await within(editDialog).findByText('Cannot move a collection inside its own descendant.'),
    ).toBeInTheDocument();

    // Switch back to root parent and rename successfully
    await user.click(
      within(editDialog).getByRole('combobox', {
        name: SHARED_COLLECTION_STRINGS.formParentLabel,
      }),
    );
    await user.click(
      await screen.findByRole('option', { name: SHARED_COLLECTION_STRINGS.formParentRootOption }),
    );
    const titleInput = within(editDialog).getByLabelText(/Title/i);
    await user.clear(titleInput);
    await user.type(titleInput, 'Reading Archive');
    await user.click(
      within(editDialog).getByRole('button', { name: SHARED_COLLECTION_STRINGS.formSaveSubmit }),
    );

    expect(await screen.findByText('Reading Archive')).toBeInTheDocument();

    // WS sync event updates collection in place without manual refetch
    server.use(
      http.get('*/api/v1/sync/changes', () =>
        HttpResponse.json({
          resyncRequired: false,
          cursor: '12',
          changes: [
            {
              seq: '12',
              entity: 'collection',
              id: 'col-4',
              action: 'update',
              snapshot: {
                id: 'col-4',
                parentId: null,
                title: 'Synced Design',
                icon: null,
                color: null,
                order: 1,
                share: { enabled: false, shareToken: null },
                createdAt: '2026-11-14T00:00:00.000Z',
                updatedAt: '2026-11-14T06:00:00.000Z',
                deletedAt: null,
              },
            },
          ],
        }),
      ),
    );
    testFakeWsController.latest?.simulateMessage({
      seq: '12',
      entity: 'collection',
      id: 'col-4',
      action: 'update',
    });

    expect(await screen.findByText('Synced Design')).toBeInTheDocument();
  }, 60_000);

  it('enforces two-phase delete (409 blocked-with-children -> cascade=trash subtree)', async () => {
    const user = userEvent.setup({ delay: null });
    let tree = makeFixtureTree();
    const deleteRequests: string[] = [];

    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: tree })),
      http.get('*/api/v1/collections/tree', () => HttpResponse.json(buildTreeNodes(tree))),
      http.delete('*/api/v1/collections/:id', ({ params, request }) => {
        const id = String(params.id);
        const cascade = new URL(request.url).searchParams.get('cascade');
        deleteRequests.push(`${id}:${cascade ?? 'none'}`);

        if (id === 'col-1' && cascade !== 'trash') {
          return problemJsonResponse(409, {
            code: 'COLLECTION_HAS_CHILDREN',
            title: 'Conflict',
            detail: 'Collection has child collections; use cascade=trash to remove the subtree.',
          });
        }

        tree = tree.filter((col) => col.id !== 'col-1' && col.id !== 'col-2' && col.id !== 'col-3');
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderShellAt('/collections/col-1');
    expect(await screen.findByRole('heading', { name: 'Reading List' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collection actions: Reading List' }));
    await user.click(
      await screen.findByRole('menuitem', { name: SHARED_COLLECTION_STRINGS.menuDelete }),
    );

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: SHARED_COLLECTION_STRINGS.deleteConfirm }),
    );

    expect(
      await within(dialog).findByText(
        'Collection has child collections; use cascade=trash to remove the subtree.',
      ),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', {
        name: SHARED_COLLECTION_STRINGS.deleteCascadeConfirm,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(deleteRequests).toEqual(['col-1:none', 'col-1:trash']);
    await waitFor(() => {
      expect(screen.queryByText('Reading List')).not.toBeInTheDocument();
    });
  });

  it('produces API calls for dnd nest (and cycle 409), sibling reorder, and bookmark-onto-collection', async () => {
    const tree = makeFixtureTree();
    const putCalls: Array<{ id: string; parentId: string | null }> = [];
    const orderCalls: Array<Array<{ id: string; order: number }>> = [];
    const bulkCalls: Array<{
      action: string;
      mode?: string;
      ids: string[];
      collectionIds?: string[];
    }> = [];

    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: tree })),
      http.get('*/api/v1/collections/tree', () => HttpResponse.json(buildTreeNodes(tree))),
      http.put('*/api/v1/collections/:id', async ({ params, request }) => {
        const id = String(params.id);
        const body = (await request.json()) as { parentId?: string | null };
        putCalls.push({ id, parentId: body.parentId ?? null });
        if (id === 'col-1' && body.parentId === 'col-2') {
          return problemJsonResponse(409, {
            code: 'COLLECTION_CYCLE',
            title: 'Conflict',
            detail: 'Cannot nest a collection inside its own descendant.',
          });
        }
        const match = tree.find((c) => c.id === id) ?? makeMockCollection({ id });
        return HttpResponse.json({ ...match, parentId: body.parentId ?? null });
      }),
      http.patch('*/api/v1/collections/order', async ({ request }) => {
        const body = (await request.json()) as { items: Array<{ id: string; order: number }> };
        orderCalls.push(body.items);
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('*/api/v1/bookmarks/bulk', async ({ request }) => {
        const body = (await request.json()) as {
          action: string;
          mode?: string;
          ids: string[];
          collectionIds?: string[];
        };
        bulkCalls.push(body);
        return HttpResponse.json({ action: body.action, affected: body.ids.length, ids: body.ids });
      }),
    );

    const makeRect = (top: number, height = 32): DOMRect =>
      ({
        top,
        bottom: top + height,
        left: 0,
        right: 240,
        width: 240,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    const rectsByTestId: Record<string, DOMRect> = {
      'col-reorder-slot-col-1': makeRect(100, 12),
      'col-tree-row-col-1': makeRect(112, 36),
      'col-drag-handle-col-1': makeRect(118, 20),
      'col-reorder-slot-col-2': makeRect(150, 12),
      'col-tree-row-col-2': makeRect(162, 36),
      'col-drag-handle-col-2': makeRect(168, 20),
      'col-reorder-slot-col-4': makeRect(200, 12),
      'col-tree-row-col-4': makeRect(212, 36),
      'col-drag-handle-col-4': makeRect(218, 20),
      'bookmark-drag-handle-bm-2': makeRect(400, 24),
    };

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const testId = this.getAttribute('data-testid');
      if (testId && rectsByTestId[testId]) {
        return rectsByTestId[testId];
      }
      return makeRect(500, 30);
    });

    // Expand col-1 in localStorage first so col-2 is visible for cycle-409 drag test
    localStorage.setItem('arcdrop.collectionTree.expanded', JSON.stringify({ 'col-1': true }));

    renderShellAt('/');
    expect(await screen.findByText('Design Systems')).toBeInTheDocument();
    expect(await screen.findByText('MUI Design Tokens Reference')).toBeInTheDocument();

    // 1) Sibling reorder: drag col-4 onto reorder slot before col-1
    await performPointerDrag(
      screen.getByTestId('col-drag-handle-col-4'),
      { x: 100, y: 224 },
      () => ({ x: 100, y: 106 }),
    );

    await waitFor(() => {
      expect(orderCalls).toHaveLength(1);
    });
    expect(orderCalls[0]).toEqual([
      { id: 'col-4', order: 0 },
      { id: 'col-1', order: 1 },
    ]);

    // 2) Drag-to-nest cycle conflict: drag col-1 onto col-2 (its own child)
    await performPointerDrag(
      screen.getByTestId('col-drag-handle-col-1'),
      { x: 100, y: 128 },
      () => ({ x: 100, y: 180 }),
    );

    await waitFor(() => {
      expect(putCalls).toContainEqual({ id: 'col-1', parentId: 'col-2' });
    });
    expect(
      await screen.findByText('Cannot nest a collection inside its own descendant.'),
    ).toBeInTheDocument();

    // 3) Bookmark drag onto collection: drag bm-2 onto col-4
    await performPointerDrag(
      screen.getByTestId('bookmark-drag-handle-bm-2'),
      { x: 100, y: 412 },
      () => ({ x: 100, y: 230 }),
    );

    await waitFor(() => {
      expect(bulkCalls).toHaveLength(1);
    });
    expect(bulkCalls[0]).toEqual({
      action: 'move',
      mode: 'union',
      ids: ['bm-2'],
      collectionIds: ['col-4'],
    });
  });
});
