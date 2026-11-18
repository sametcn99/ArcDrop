import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_URL_STORAGE_KEY } from '../../api/baseUrl';
import { useAuthStore } from '../../stores/authStore';
import { ThemeController } from '../../theme/ThemeController';
import { appRoutes } from '../../app/routes';

function renderAtServerUnreachable() {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/server-unreachable'],
  });
  return render(
    <ThemeController>
      <RouterProvider router={router} />
    </ThemeController>,
  );
}

describe('ServerUnreachablePage (plan T5)', () => {
  beforeEach(() => {
    window.localStorage.removeItem(BASE_URL_STORAGE_KEY);
    window.localStorage.removeItem('arcdrop.refreshToken');
    useAuthStore.setState({ serverUnreachable: false, status: 'unauthenticated' });
  });

  it('shows the active server address and keeps the persisted session', async () => {
    window.localStorage.setItem('arcdrop.refreshToken', 'kept-token');
    window.localStorage.setItem(BASE_URL_STORAGE_KEY, 'https://stored.example.com');

    renderAtServerUnreachable();

    expect(
      await screen.findByRole('heading', { name: 'Cannot reach your server' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('server-unreachable-url')).toHaveTextContent(
      'https://stored.example.com',
    );
    // The refresh token survives — retry must not require re-signing-in.
    expect(window.localStorage.getItem('arcdrop.refreshToken')).toBe('kept-token');
  });

  it('retry re-runs session restore through the auth store', async () => {
    const user = userEvent.setup();
    const restoreSpy = vi.fn().mockResolvedValue(true);
    useAuthStore.setState({ restoreSession: restoreSpy });

    renderAtServerUnreachable();

    await user.click(screen.getByTestId('server-unreachable-retry'));
    expect(restoreSpy).toHaveBeenCalledTimes(1);
    // The busy state clears after the restore settles.
    expect(await screen.findByTestId('server-unreachable-retry')).toBeEnabled();
  });

  it('change server navigates to the onboarding screen', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ restoreSession: vi.fn().mockResolvedValue(false) });

    renderAtServerUnreachable();

    await user.click(screen.getByRole('button', { name: 'Change server' }));
    expect(
      await screen.findByRole('heading', { name: 'Connect to your server' }),
    ).toBeInTheDocument();
  });
});
