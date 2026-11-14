import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import { useAuthStore } from '../../stores/authStore';
import {
  makeMockBookmark,
  makeMockCollection,
  makeMockSession,
  makeMockTagUsage,
} from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';
import { SnackbarHost } from './SnackbarHost';

function renderAt(path: string) {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'quickadd@arcdrop.test' },
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

describe('QuickAddDialog', () => {
  it('opens from AppBar Quick add button, creates bookmark with collection and tags, and allows duplicate URLs', async () => {
    const user = userEvent.setup();
    const createdPosts: Array<{
      collection: string | null;
      body: { url?: string; title?: string; favorite?: boolean };
    }> = [];
    const tagReplacings: Array<{ id: string; tags: string[] }> = [];
    let nextId = 1;

    server.use(
      http.get('*/api/v1/collections', () =>
        HttpResponse.json({
          items: [makeMockCollection({ id: 'col-reading', title: 'Reading List' })],
        }),
      ),
      http.get('*/api/v1/bookmarks/tags', () =>
        HttpResponse.json([makeMockTagUsage({ id: 'tag-1', name: 'architecture', count: 1 })]),
      ),
      http.post('*/api/v1/bookmarks', async ({ request }) => {
        const reqUrl = new URL(request.url);
        const body = (await request.json()) as {
          url?: string;
          title?: string;
          favorite?: boolean;
        };
        createdPosts.push({
          collection: reqUrl.searchParams.get('collection'),
          body,
        });
        const id = `bm-qa-${nextId}`;
        nextId += 1;
        return HttpResponse.json(
          makeMockBookmark({
            id,
            url: body.url ?? 'https://example.test',
            title: body.title ?? null,
            favorite: Boolean(body.favorite),
            tags: [],
          }),
          { status: 201 },
        );
      }),
      http.put('*/api/v1/bookmarks/:id/tags', async ({ params, request }) => {
        const id = String(params.id);
        const body = (await request.json()) as { tags: string[] };
        tagReplacings.push({ id, tags: body.tags });
        return HttpResponse.json(
          makeMockBookmark({
            id,
            url: 'https://arcdrop.test/dup',
            title: 'Duplicate Friendly Article',
            favorite: true,
            tags: body.tags.map((name, idx) => ({ id: `t-${idx}`, name })),
          }),
        );
      }),
    );

    renderAt('/');

    const quickAddBtns = await screen.findAllByRole('button', { name: 'Quick add' });
    const triggerBtn = quickAddBtns[0];
    if (!triggerBtn) throw new Error('Quick add button missing');
    await user.click(triggerBtn);

    const dialog = await screen.findByRole('dialog', { name: 'Quick add bookmark' });
    await user.type(within(dialog).getByLabelText(/^URL/i), 'https://arcdrop.test/dup');
    await user.type(within(dialog).getByLabelText('Title'), 'Duplicate Friendly Article');

    // Select collection
    await user.click(within(dialog).getByLabelText('Collection'));
    await user.click(await screen.findByRole('option', { name: 'Reading List' }));

    // Add tag
    const tagsInput = within(dialog).getByRole('combobox', { name: 'Tags' });
    await user.type(tagsInput, 'architecture{Enter}');

    // Mark favorite
    await user.click(within(dialog).getByLabelText('Mark as favorite'));

    await user.click(within(dialog).getByRole('button', { name: 'Save bookmark' }));

    await waitFor(() => {
      expect(createdPosts).toHaveLength(1);
    });
    expect(createdPosts[0]).toEqual({
      collection: 'col-reading',
      body: {
        url: 'https://arcdrop.test/dup',
        title: 'Duplicate Friendly Article',
        favorite: true,
      },
    });
    expect(tagReplacings).toEqual([{ id: 'bm-qa-1', tags: ['architecture'] }]);
    expect(await screen.findByText('Duplicate Friendly Article')).toBeInTheDocument();

    // Submit the exact same URL a second time -> duplicate-friendly (D13)
    await user.click(triggerBtn);
    const secondDialog = await screen.findByRole('dialog', { name: 'Quick add bookmark' });
    await user.type(within(secondDialog).getByLabelText(/^URL/i), 'https://arcdrop.test/dup');
    await user.click(within(secondDialog).getByRole('button', { name: 'Save bookmark' }));

    await waitFor(() => {
      expect(createdPosts).toHaveLength(2);
    });
  });

  it('pre-populates from /quick-add query-param contract', async () => {
    const user = userEvent.setup();
    let capturedCollection: string | null = null;
    let capturedBody: Record<string, unknown> | null = null;
    let capturedTags: string[] | null = null;

    server.use(
      http.get('*/api/v1/collections', () =>
        HttpResponse.json({
          items: [makeMockCollection({ id: 'col-reading', title: 'Reading List' })],
        }),
      ),
      http.post('*/api/v1/bookmarks', async ({ request }) => {
        capturedCollection = new URL(request.url).searchParams.get('collection');
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          makeMockBookmark({
            id: 'bm-from-qp',
            url: String(capturedBody.url),
            title: String(capturedBody.title ?? ''),
            favorite: Boolean(capturedBody.favorite),
            tags: [],
          }),
          { status: 201 },
        );
      }),
      http.put('*/api/v1/bookmarks/bm-from-qp/tags', async ({ request }) => {
        const body = (await request.json()) as { tags: string[] };
        capturedTags = body.tags;
        return HttpResponse.json(
          makeMockBookmark({
            id: 'bm-from-qp',
            tags: body.tags.map((name, idx) => ({ id: `t-${idx}`, name })),
          }),
        );
      }),
    );

    renderAt(
      '/quick-add?url=https%3A%2F%2Farcdrop.test%2Fqp&title=Shared%20Page&collection=Reading%20List&tags=web,reading&favorite=true',
    );

    const dialog = await screen.findByRole('dialog', { name: 'Quick add bookmark' });
    expect(within(dialog).getByLabelText(/^URL/i)).toHaveValue('https://arcdrop.test/qp');
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Shared Page');
    expect(within(dialog).getByLabelText('Mark as favorite')).toBeChecked();
    expect(within(dialog).getByText('#web')).toBeInTheDocument();
    expect(within(dialog).getByText('#reading')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Collection')).toHaveTextContent('Reading List');
    });

    await user.click(within(dialog).getByRole('button', { name: 'Save bookmark' }));

    await waitFor(() => {
      expect(capturedCollection).toBe('col-reading');
      expect(capturedBody).toEqual({
        url: 'https://arcdrop.test/qp',
        title: 'Shared Page',
        favorite: true,
      });
      expect(capturedTags).toEqual(['web', 'reading']);
    });
  });
});
