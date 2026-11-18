import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { BASE_URL_STORAGE_KEY } from '../../api/baseUrl';
import { apiClient } from '../../api/client';
import { appRoutes } from '../../app/routes';
import { useAuthStore } from '../../stores/authStore';
import { makeMockSession } from '../../test/msw/handlers';
import { ThemeController } from '../../theme/ThemeController';

function renderAtSettings() {
  useAuthStore.getState().setSession(makeMockSession());
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/settings'] });
  return render(
    <ThemeController>
      <RouterProvider router={router} />
    </ThemeController>,
  );
}

describe('SettingsPage server section', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    window.localStorage.removeItem(BASE_URL_STORAGE_KEY);
  });

  it('shows the active API base URL from the running client', async () => {
    apiClient.setBaseUrl('https://arcdrop.example.com');

    renderAtSettings();

    // The settings page is lazy-loaded; wait for the chunk to resolve.
    expect(await screen.findByTestId('settings-server-url')).toHaveTextContent(
      'https://arcdrop.example.com',
    );
    apiClient.setBaseUrl('');
  });

  it('falls back to the page origin in same-origin mode', async () => {
    apiClient.setBaseUrl('');

    renderAtSettings();

    expect(await screen.findByTestId('settings-server-url')).toHaveTextContent(
      window.location.origin,
    );
  });

  it('change server signs the user out and returns to the onboarding screen', async () => {
    const user = userEvent.setup();
    renderAtSettings();

    await user.click(await screen.findByTestId('settings-server-change'));

    await waitFor(() => {
      expect(useAuthStore.getState().status).toBe('unauthenticated');
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(apiClient.getRefreshToken()).toBeNull();
    expect(
      await screen.findByRole('heading', { name: 'Connect to your server' }),
    ).toBeInTheDocument();
  });
});
