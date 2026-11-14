import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import type { TagUsage } from '../../api/schemas/bookmarks';
import { useAuthStore } from '../../stores/authStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { makeMockBookmark, makeMockSession, makeMockTagUsage } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { waitForLibraryReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';
import { SnackbarHost } from './SnackbarHost';

function renderShell() {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'tags@arcdrop.test' },
    }),
  );

  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/'],
  });

  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('TagManagerDialog', () => {
  it('opens from sidebar footer, displays usage counts, renames, merges, and delete-detaches tags', async () => {
    const user = userEvent.setup({ delay: null });
    let tagRows: TagUsage[] = [
      makeMockTagUsage({ id: 'tag-arch', name: 'architecture', count: 3 }),
      makeMockTagUsage({ id: 'tag-work', name: 'work', count: 2 }),
      makeMockTagUsage({ id: 'tag-draft', name: 'draft', count: 1 }),
    ];

    const bm1 = makeMockBookmark({
      id: 'bm-1',
      title: 'System Design',
      tags: [
        { id: 'tag-arch', name: 'architecture' },
        { id: 'tag-draft', name: 'draft' },
      ],
    });

    const renameCalls: Array<{ from: string; to: string }> = [];
    const deleteCalls: string[] = [];

    server.use(
      http.get('*/api/v1/bookmarks', () =>
        HttpResponse.json({ items: [bm1], totalCount: 1, page: 1, pageSize: 24 }),
      ),
      http.get('*/api/v1/bookmarks/tags', () => HttpResponse.json(tagRows)),
      http.put('*/api/v1/tags/:name', async ({ params, request }) => {
        const from = decodeURIComponent(String(params.name));
        const body = (await request.json()) as { name: string };
        renameCalls.push({ from, to: body.name });

        const targetExisting = tagRows.find(
          (t) => t.name.toLowerCase() === body.name.toLowerCase(),
        );
        if (targetExisting && targetExisting.name.toLowerCase() !== from.toLowerCase()) {
          const sourceRow = tagRows.find((t) => t.name.toLowerCase() === from.toLowerCase());
          tagRows = tagRows
            .filter((t) => t.name.toLowerCase() !== from.toLowerCase())
            .map((t) =>
              t.id === targetExisting.id ? { ...t, count: t.count + (sourceRow?.count ?? 0) } : t,
            );
          return HttpResponse.json({ id: targetExisting.id, name: targetExisting.name });
        }

        const matched = tagRows.find((t) => t.name.toLowerCase() === from.toLowerCase());
        tagRows = tagRows.map((t) =>
          t.name.toLowerCase() === from.toLowerCase() ? { ...t, name: body.name } : t,
        );
        return HttpResponse.json({ id: matched?.id ?? 'tag-renamed', name: body.name });
      }),
      http.delete('*/api/v1/tags/:name', ({ params }) => {
        const name = decodeURIComponent(String(params.name));
        deleteCalls.push(name);
        tagRows = tagRows.filter((t) => t.name.toLowerCase() !== name.toLowerCase());
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderShell();
    await waitForLibraryReady();

    const manageTagsButtons = await screen.findAllByRole('button', { name: /Manage tags/i });
    const manageBtn = manageTagsButtons[0];
    if (!manageBtn) throw new Error('Manage tags button missing');
    await user.click(manageBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Manage tags' });
    expect(await within(dialog).findByText('3 bookmarks')).toBeInTheDocument();
    expect(within(dialog).getByText('2 bookmarks')).toBeInTheDocument();
    expect(within(dialog).getByText('1 bookmark')).toBeInTheDocument();

    // Rename 'draft' -> 'notes'
    await user.click(within(dialog).getByRole('button', { name: 'Rename draft' }));
    const renameInput = within(dialog).getByLabelText('New tag name');
    await user.clear(renameInput);
    await user.type(renameInput, 'notes');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(renameCalls).toContainEqual({ from: 'draft', to: 'notes' });
    });
    expect(await within(dialog).findByText('#notes')).toBeInTheDocument();
    expect(useLibraryStore.getState().bookmarksById['bm-1']?.tags.map((t) => t.name)).toContain(
      'notes',
    );

    // Merge 'notes' into existing 'work' -> shows merge warning alert first
    await user.click(within(dialog).getByRole('button', { name: 'Rename notes' }));
    const mergeInput = within(dialog).getByLabelText('New tag name');
    await user.clear(mergeInput);
    await user.type(mergeInput, 'work');
    expect(
      within(dialog).getByText(/A tag named "#work" already exists\. Applying will merge/i),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(renameCalls).toContainEqual({ from: 'notes', to: 'work' });
    });
    expect(within(dialog).queryByText('#notes')).not.toBeInTheDocument();

    // Delete-detach 'architecture'
    await user.click(within(dialog).getByRole('button', { name: 'Delete architecture' }));
    expect(
      within(dialog).getByText(/Detach "#architecture" from all bookmarks/i),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete tag' }));

    await waitFor(() => {
      expect(deleteCalls).toEqual(['architecture']);
    });
    expect(within(dialog).queryByText('#architecture')).not.toBeInTheDocument();
    // Bookmark itself remains in library without the deleted tag
    const remainingBookmark = useLibraryStore.getState().bookmarksById['bm-1'];
    expect(remainingBookmark).toBeDefined();
    expect(remainingBookmark?.tags.map((t) => t.name)).not.toContain('architecture');
  }, 60_000);
});
