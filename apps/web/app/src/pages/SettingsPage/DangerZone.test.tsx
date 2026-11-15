import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useSyncStore } from '../../stores/syncStore';
import { makeMockBookmark, makeMockSession } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';

function renderSettings() {
  useAuthStore.getState().setSession(makeMockSession());
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/settings'] });
  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('SettingsPage danger zone', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useLibraryStore.getState().reset();
    useSyncStore.getState().reset();
  });

  it('resets the library with password confirmation and rebuilds local state', async () => {
    const user = userEvent.setup({ delay: null });
    const resetBodies: Array<{ password: string } | null> = [];

    useLibraryStore.getState().upsertBookmark(makeMockBookmark({ id: 'bm-dz-reset' }));
    useSyncStore.getState().markSynced('42');

    server.use(
      http.post('*/api/v1/me/reset-data', async ({ request }) => {
        resetBodies.push((await request.json()) as { password: string });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderSettings();

    await user.click(await screen.findByTestId('settings-danger-reset-open'));
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByTestId('settings-danger-reset-confirm'));

    await waitFor(() => {
      expect(resetBodies).toEqual([{ password: 'correct-horse' }]);
    });
    await screen.findByText('Library reset. Sync restarted from a clean state.');
    // The wiped library must be dropped from local state (the seeded bookmark
    // is gone even after the sync engine re-bootstraps from the empty server).
    await waitFor(() => {
      expect(useLibraryStore.getState().bookmarksById['bm-dz-reset']).toBeUndefined();
    });
  });

  it('keeps the reset dialog open with the API error when the password is wrong', async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.post('*/api/v1/me/reset-data', () =>
        HttpResponse.json(
          {
            type: 'https://arcdrop.dev/problems/invalid-credentials',
            title: 'Unauthorized',
            status: 401,
            code: 'INVALID_CREDENTIALS',
            detail: 'Password is incorrect.',
          },
          { status: 401 },
        ),
      ),
    );

    renderSettings();

    await user.click(await screen.findByTestId('settings-danger-reset-open'));
    await user.type(screen.getByLabelText('Password'), 'wrong-pass');
    await user.click(screen.getByTestId('settings-danger-reset-confirm'));

    expect(await screen.findByTestId('settings-danger-error')).toHaveTextContent(
      'Password is incorrect.',
    );
    // Dialog stays open for a retry.
    expect(screen.getByTestId('settings-danger-password')).toBeInTheDocument();
  });

  it('deletes the account after typing DELETE, then signs out locally', async () => {
    const user = userEvent.setup({ delay: null });
    const deleteBodies: Array<{ password: string } | null> = [];

    server.use(
      http.delete('*/api/v1/me', async ({ request }) => {
        deleteBodies.push((await request.json()) as { password: string });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderSettings();

    await user.click(await screen.findByTestId('settings-danger-delete-open'));
    const confirmButton = screen.getByTestId('settings-danger-delete-confirm');
    expect(confirmButton).toBeDisabled();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    await waitFor(() => {
      expect(deleteBodies).toEqual([{ password: 'correct-horse' }]);
    });
    await waitFor(() => {
      expect(useAuthStore.getState().status).toBe('unauthenticated');
    });
  });

  it('surfaces the last-active-admin 409 on account deletion', async () => {
    const user = userEvent.setup({ delay: null });

    server.use(
      http.delete('*/api/v1/me', () =>
        HttpResponse.json(
          {
            type: 'https://arcdrop.dev/problems/last-admin',
            title: 'Conflict',
            status: 409,
            code: 'LAST_ACTIVE_ADMIN',
            detail: 'The last active admin account cannot be deleted.',
          },
          { status: 409 },
        ),
      ),
    );

    renderSettings();

    await user.click(await screen.findByTestId('settings-danger-delete-open'));
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByTestId('settings-danger-delete-confirm'));

    expect(await screen.findByTestId('settings-danger-error')).toHaveTextContent(
      'The last active admin account cannot be deleted.',
    );
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});
