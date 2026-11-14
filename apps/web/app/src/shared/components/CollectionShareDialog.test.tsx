import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Collection } from '../../api/schemas/collections';
import { appRoutes } from '../../app/routes';
import { useAuthStore } from '../../stores/authStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { makeMockCollection, makeMockSession } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';
import { SHARED_COLLECTION_STRINGS } from '../strings';
import { SnackbarHost } from './SnackbarHost';

function renderShellAt(path = '/') {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'share@arcdrop.test' },
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

function makeFixtureCollections(): Collection[] {
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

describe('CollectionShareDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('manages share URLs, copy buttons, disable rotation warning, and shared=true filter', async () => {
    const user = userEvent.setup({ delay: null });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    let shareCounter = 0;
    let collections = makeFixtureCollections();

    server.use(
      http.get('*/api/v1/collections', ({ request }) => {
        const sharedParam = new URL(request.url).searchParams.get('shared');
        const items =
          sharedParam === 'true' ? collections.filter((col) => col.share.enabled) : collections;
        return HttpResponse.json({ items });
      }),
      http.get('*/api/v1/collections/tree', () => HttpResponse.json(buildTreeNodes(collections))),
      http.put('*/api/v1/collections/:id/share', async ({ params, request }) => {
        const id = String(params.id);
        const body = (await request.json()) as { enabled: boolean };
        const shareToken = body.enabled ? `tok-${++shareCounter}` : null;
        collections = collections.map((col) =>
          col.id === id ? { ...col, share: { enabled: body.enabled, shareToken } } : col,
        );
        return HttpResponse.json({
          collectionId: id,
          enabled: body.enabled,
          shareToken,
          publicPath: shareToken ? `/api/v1/public/collections/${shareToken}` : null,
          rssPath: shareToken ? `/api/v1/public/collections/${shareToken}/rss` : null,
        });
      }),
    );

    renderShellAt('/');
    expect(await screen.findByText('Reading List')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collection actions: Reading List' }));
    await user.click(
      await screen.findByRole('menuitem', { name: SHARED_COLLECTION_STRINGS.menuShare }),
    );

    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('switch', { name: SHARED_COLLECTION_STRINGS.shareToggleLabel }),
    );

    const publicInput = (await within(dialog).findByLabelText(
      SHARED_COLLECTION_STRINGS.sharePublicUrlLabel,
    )) as HTMLInputElement;
    const rssInput = within(dialog).getByLabelText(
      SHARED_COLLECTION_STRINGS.shareRssUrlLabel,
    ) as HTMLInputElement;
    expect(publicInput.value).toContain('/api/v1/public/collections/tok-1');
    expect(rssInput.value).toContain('/api/v1/public/collections/tok-1/rss');

    await user.click(within(dialog).getByRole('button', { name: 'Copy URL: Public URL' }));
    await user.click(within(dialog).getByRole('button', { name: 'Copy URL: RSS feed URL' }));
    expect(writeText).toHaveBeenCalledWith(publicInput.value);
    expect(writeText).toHaveBeenCalledWith(rssInput.value);

    // Close dialog & verify Shared filter lists only col-1
    await user.click(
      within(dialog).getByRole('button', { name: SHARED_COLLECTION_STRINGS.shareClose }),
    );
    await user.click(screen.getByRole('button', { name: SHARED_COLLECTION_STRINGS.filterShared }));

    const sharedList = await screen.findByTestId('shared-collections-list');
    expect(within(sharedList).getByText('Reading List')).toBeInTheDocument();
    expect(within(sharedList).queryByText('Design Systems')).not.toBeInTheDocument();

    // Disable sharing via confirmation warning noting token rotation
    await user.click(
      within(sharedList).getByRole('button', {
        name: `${SHARED_COLLECTION_STRINGS.menuShare}: Reading List`,
      }),
    );
    const shareDialog2 = await screen.findByRole('dialog');
    await user.click(
      within(shareDialog2).getByRole('switch', {
        name: SHARED_COLLECTION_STRINGS.shareToggleLabel,
      }),
    );
    expect(
      within(shareDialog2).getByText(SHARED_COLLECTION_STRINGS.shareDisableConfirmBody),
    ).toBeInTheDocument();
    await user.click(
      within(shareDialog2).getByRole('button', {
        name: SHARED_COLLECTION_STRINGS.shareDisableConfirm,
      }),
    );

    await waitFor(() => {
      expect(
        within(shareDialog2).queryByLabelText(SHARED_COLLECTION_STRINGS.sharePublicUrlLabel),
      ).not.toBeInTheDocument();
    });
    expect(useLibraryStore.getState().collectionsById['col-1']?.share).toEqual({
      enabled: false,
      shareToken: null,
    });

    // Re-enabling rotates token to tok-2
    await user.click(
      within(shareDialog2).getByRole('switch', {
        name: SHARED_COLLECTION_STRINGS.shareToggleLabel,
      }),
    );
    const rotatedPublicInput = (await within(shareDialog2).findByLabelText(
      SHARED_COLLECTION_STRINGS.sharePublicUrlLabel,
    )) as HTMLInputElement;
    expect(rotatedPublicInput.value).toContain('/api/v1/public/collections/tok-2');

    await user.click(
      within(shareDialog2).getByRole('button', { name: SHARED_COLLECTION_STRINGS.shareClose }),
    );
  });
});
