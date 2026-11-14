import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useAuthStore } from '../stores/authStore';
import { useSyncStore } from '../stores/syncStore';
import { makeMockSession } from '../test/msw/handlers';
import { ThemeController } from '../theme/ThemeController';
import { appRoutes } from './routes';

function renderAtRoute(path: string) {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [path],
  });

  return render(
    <ThemeController>
      <RouterProvider router={router} />
    </ThemeController>,
  );
}

describe('AppLayout and router shell', () => {
  it('renders the AppBar, search placeholder, sync indicator, Drawer nav, and Library on / when authenticated', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'admin', email: 'admin@arcdrop.test' },
      }),
    );
    renderAtRoute('/');

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getAllByText('ArcDrop').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Collections').length).toBeGreaterThan(0);
    expect(screen.getByText('admin@arcdrop.test')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search bookmarks (arrives in W5)')).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByTestId('sync-status-indicator')).toHaveAttribute(
        'data-sync-state',
        'live',
      );
    });
  });

  it('reflects live, polling, and offline sync states in the AppBar status indicator', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'user', email: 'sync@arcdrop.test' },
      }),
    );
    renderAtRoute('/');

    const indicator = await screen.findByTestId('sync-status-indicator');
    await waitFor(() => {
      expect(indicator).toHaveAttribute('data-sync-state', 'live');
    });
    expect(indicator).toHaveTextContent('Live · #10');

    act(() => {
      useSyncStore.getState().setConnectionState('polling');
      useSyncStore.getState().setCursor('14');
    });
    expect(indicator).toHaveAttribute('data-sync-state', 'polling');
    expect(indicator).toHaveTextContent('Polling · #14');

    act(() => {
      useSyncStore.getState().setConnectionState('offline');
    });
    expect(indicator).toHaveAttribute('data-sync-state', 'offline');
    expect(indicator).toHaveTextContent('Offline · #14');
  });

  it('toggles desktop sidebar collapse and opens the account menu', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'user', email: 'member@arcdrop.test' },
      }),
    );
    renderAtRoute('/');

    const toggleSidebarBtn = await screen.findByRole('button', { name: 'Toggle sidebar' });
    expect(toggleSidebarBtn).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggleSidebarBtn);
    expect(toggleSidebarBtn).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'member@arcdrop.test' }));
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('toggles theme from the AppBar ThemeSwitcher', async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'admin', email: 'admin@arcdrop.test' },
      }),
    );
    renderAtRoute('/');

    await user.click(await screen.findByRole('button', { name: 'Switch theme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Dark' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it.each([
    ['/login', 'Sign in'],
    ['/bootstrap', 'Initial setup'],
    ['/claim', 'Claim invite or reset token'],
    ['/s/share-token-1', 'Shared collection'],
  ])('renders unauthenticated lazy route %s with heading %s', async (path, heading) => {
    renderAtRoute(path);

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it.each([
    ['/collections/col-1', 'Reading List'],
    ['/bookmarks/bm-1', 'Bookmark detail'],
    ['/trash', 'Trash'],
    ['/health', 'Library health'],
    ['/portability', 'Import & export'],
    ['/settings', 'Settings'],
    ['/admin', 'Administration'],
  ])('renders authenticated lazy route %s with heading %s', async (path, heading) => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'admin', email: 'admin@arcdrop.test' },
      }),
    );
    renderAtRoute(path);

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });
});
