import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { ThemeController } from '../../theme/ThemeController';
import { COLLECTION_PAGE_STRINGS } from './strings';

function renderCollectionAt(path = '/collections/col-2') {
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

describe('CollectionPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders collection heading, ancestor breadcrumbs, scoped bookmarks, and layout switcher', async () => {
    const user = userEvent.setup();
    const seenQueries: Array<{ collectionId: string | null; sort: string | null }> = [];

    const collections = [
      makeMockCollection({ id: 'col-1', parentId: null, title: 'Engineering', bookmarkCount: 1 }),
      makeMockCollection({
        id: 'col-2',
        parentId: 'col-1',
        title: 'Architecture',
        bookmarkCount: 2,
      }),
    ];

    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: collections })),
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const url = new URL(request.url);
        const collectionId = url.searchParams.get('collectionId');
        const sort = url.searchParams.get('sort');
        seenQueries.push({ collectionId, sort });
        return HttpResponse.json({
          items: [
            makeMockBookmark({ id: 'bm-1', title: 'Scoped Item One' }),
            makeMockBookmark({ id: 'bm-2', title: 'Scoped Item Two' }),
          ],
          totalCount: 2,
          page: 1,
          pageSize: 24,
        });
      }),
    );

    renderCollectionAt('/collections/col-2');

    expect(await screen.findByRole('heading', { name: 'Architecture' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Engineering' })).toBeInTheDocument();
    expect(await screen.findByText('Scoped Item One')).toBeInTheDocument();
    expect(screen.getByText('Scoped Item Two')).toBeInTheDocument();

    expect(seenQueries.some((q) => q.collectionId === 'col-2')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Grid' }));
    expect(screen.getByTestId('library-layout-grid')).toBeInTheDocument();
  });

  it('supports sort=manual with drag-and-drop and accessible move controls patching bookmark order', async () => {
    const user = userEvent.setup();
    const orderPatches: Array<{
      collectionId: string;
      items: Array<{ bookmarkId: string; order: number }>;
    }> = [];
    let shouldFailNextPatch = false;

    const bm1 = makeMockBookmark({ id: 'bm-1', title: 'First Manual Bookmark' });
    const bm2 = makeMockBookmark({ id: 'bm-2', title: 'Second Manual Bookmark' });

    server.use(
      http.get('*/api/v1/collections', () =>
        HttpResponse.json({
          items: [makeMockCollection({ id: 'col-1', title: 'Manual Stack', bookmarkCount: 2 })],
        }),
      ),
      http.get('*/api/v1/bookmarks', ({ request }) => {
        const url = new URL(request.url);
        const sort = url.searchParams.get('sort');
        if (sort === 'manual') {
          return HttpResponse.json({
            items: [bm1, bm2],
            totalCount: 2,
            page: 1,
            pageSize: 24,
          });
        }
        return HttpResponse.json({
          items: [bm1, bm2],
          totalCount: 2,
          page: 1,
          pageSize: 24,
        });
      }),
      http.patch('*/api/v1/collections/:id/bookmarks/order', async ({ params, request }) => {
        const body = (await request.json()) as {
          items: Array<{ bookmarkId: string; order: number }>;
        };
        if (shouldFailNextPatch) {
          return problemJsonResponse(500, {
            code: 'INTERNAL_ERROR',
            title: 'Internal Error',
            detail: 'Order update failed',
          });
        }
        orderPatches.push({ collectionId: String(params.id), items: body.items });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const makeRect = (top: number, height = 80): DOMRect =>
      ({
        top,
        bottom: top + height,
        left: 300,
        right: 900,
        width: 600,
        height,
        x: 300,
        y: top,
        toJSON: () => ({}),
      }) as DOMRect;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const cardEl = this.closest('[data-testid^="bookmark-item-"]');
      const listEl = this.closest('[data-testid="library-layout-list"]');
      if (cardEl && listEl) {
        const siblings = Array.from(listEl.querySelectorAll('[data-testid^="bookmark-item-"]'));
        const idx = siblings.indexOf(cardEl);
        if (idx !== -1) {
          return makeRect(100 + idx * 100);
        }
      }
      return makeRect(400);
    });

    renderCollectionAt('/collections/col-1');
    expect(await screen.findByText('First Manual Bookmark')).toBeInTheDocument();

    // Switch to manual sort
    await user.click(screen.getByRole('combobox', { name: COLLECTION_PAGE_STRINGS.sortLabel }));
    await user.click(
      await screen.findByRole('option', { name: COLLECTION_PAGE_STRINGS.sortManual }),
    );

    expect(await screen.findByText(COLLECTION_PAGE_STRINGS.manualOrderHint)).toBeInTheDocument();

    // 1) Accessible move-down button reorders bm-1 after bm-2 and patches order
    await user.click(
      screen.getByRole('button', { name: 'Move bookmark down: First Manual Bookmark' }),
    );

    await waitFor(() => {
      expect(orderPatches).toHaveLength(1);
    });
    expect(orderPatches[0]).toEqual({
      collectionId: 'col-1',
      items: [
        { bookmarkId: 'bm-2', order: 0 },
        { bookmarkId: 'bm-1', order: 1 },
      ],
    });

    const listEl = screen.getByTestId('library-layout-list');
    const linksAfterMove = within(listEl).getAllByRole('link', {
      name: /^(First|Second) Manual Bookmark$/,
    });
    expect(linksAfterMove[0]).toHaveTextContent('Second Manual Bookmark');
    expect(linksAfterMove[1]).toHaveTextContent('First Manual Bookmark');

    // 2) Drag bm-1 back above bm-2 via dnd-kit SortableContext + AppLayout DndContext
    const handleBm1 = screen.getByTestId('bookmark-drag-handle-bm-1');
    await act(async () => {
      handleBm1.dispatchEvent(
        new TestPointerEvent('pointerdown', {
          button: 0,
          buttons: 1,
          clientX: 400,
          clientY: 220,
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
          clientX: 400,
          clientY: 210,
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
          clientX: 400,
          clientY: 130,
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
          clientX: 400,
          clientY: 130,
          pointerId: 1,
          isPrimary: true,
        }),
      );
    });

    await waitFor(() => {
      expect(orderPatches).toHaveLength(2);
    });
    expect(orderPatches[1]).toEqual({
      collectionId: 'col-1',
      items: [
        { bookmarkId: 'bm-1', order: 0 },
        { bookmarkId: 'bm-2', order: 1 },
      ],
    });

    // 3) Failure rolls back optimistic order
    shouldFailNextPatch = true;
    await user.click(
      screen.getByRole('button', { name: 'Move bookmark down: First Manual Bookmark' }),
    );
    expect(await screen.findByText('Order update failed')).toBeInTheDocument();
    const linksAfterRollback = within(screen.getByTestId('library-layout-list')).getAllByRole(
      'link',
      { name: /^(First|Second) Manual Bookmark$/ },
    );
    expect(linksAfterRollback[0]).toHaveTextContent('First Manual Bookmark');
  });

  it('shows not-found state when collection returns 404', async () => {
    server.use(
      http.get('*/api/v1/collections', () => HttpResponse.json({ items: [] })),
      http.get('*/api/v1/collections/missing-col', () =>
        problemJsonResponse(404, {
          code: 'NOT_FOUND',
          title: 'Not Found',
          detail: 'Collection not found.',
        }),
      ),
      http.get('*/api/v1/bookmarks', () =>
        problemJsonResponse(404, {
          code: 'NOT_FOUND',
          title: 'Not Found',
          detail: 'Collection not found.',
        }),
      ),
    );

    renderCollectionAt('/collections/missing-col');
    expect(
      await screen.findByRole('heading', { name: 'Collection not found' }),
    ).toBeInTheDocument();
  });
});
