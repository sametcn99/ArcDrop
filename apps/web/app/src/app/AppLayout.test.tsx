import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useAuthStore } from '../stores/authStore';
import { useSyncStore } from '../stores/syncStore';
import { makeMockSession } from '../test/msw/handlers';
import { waitForBootstrapReady, waitForLibraryReady } from '../test/waiters';
import { ThemeController } from '../theme/ThemeController';
import { APP_STRINGS } from './strings';
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
  it('renders the AppBar, live SearchBar, sync indicator, Drawer nav, and Library on / when authenticated', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'admin', email: 'admin@arcdrop.test' },
      }),
    );
    renderAtRoute('/');
    await waitForLibraryReady();

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getAllByText('ArcDrop').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Collections').length).toBeGreaterThan(0);
    expect(screen.getByText('admin@arcdrop.test')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search bookmarks' })).toBeEnabled();

    await waitFor(() => {
      expect(screen.getByTestId('sync-status-indicator')).toHaveAttribute(
        'data-sync-state',
        'live',
      );
    });
  }, 60_000);

  it('reflects live, polling, and offline sync states in the AppBar status indicator', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'user', email: 'sync@arcdrop.test' },
      }),
    );
    renderAtRoute('/');
    await waitForBootstrapReady();

    const indicator = await screen.findByTestId('sync-status-indicator');
    await waitFor(() => {
      expect(indicator).toHaveAttribute('data-sync-state', 'live');
    });
    expect(indicator).toHaveTextContent('Live');

    act(() => {
      useSyncStore.getState().setConnectionState('polling');
      useSyncStore.getState().setCursor('14');
    });
    expect(indicator).toHaveAttribute('data-sync-state', 'polling');
    expect(indicator).toHaveTextContent('Polling');

    act(() => {
      useSyncStore.getState().setConnectionState('offline');
    });
    expect(indicator).toHaveAttribute('data-sync-state', 'offline');
    expect(indicator).toHaveTextContent('Offline');
  }, 60_000);

  it('toggles desktop sidebar collapse and opens the account menu', async () => {
    const user = userEvent.setup({ delay: null });
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'user', email: 'member@arcdrop.test' },
      }),
    );
    renderAtRoute('/');
    await waitForBootstrapReady();

    const toggleSidebarBtn = await screen.findByRole('button', { name: 'Toggle sidebar' });
    expect(toggleSidebarBtn).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggleSidebarBtn);
    expect(toggleSidebarBtn).toHaveAttribute('aria-expanded', 'false');

    await user.click(screen.getByRole('button', { name: 'member@arcdrop.test' }));
    expect(await screen.findByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
  }, 60_000);

  it('resizes and persists the desktop sidebar width via the handle', async () => {
    const user = userEvent.setup({ delay: null });
    window.localStorage.setItem('arcdrop.sidebarWidth', '400');
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { email: 'resizer@arcdrop.test' },
      }),
    );
    renderAtRoute('/');
    await waitForBootstrapReady();

    const root = document.querySelector('[style*="--arcdrop-sidebar-width"]') as HTMLElement;
    expect(getComputedStyle(root).getPropertyValue('--arcdrop-sidebar-width')).toBe('400px');

    const handle = screen.getByTestId('sidebar-resize-handle');
    handle.focus();

    await user.keyboard('{ArrowLeft}');
    expect(getComputedStyle(root).getPropertyValue('--arcdrop-sidebar-width')).toBe('376px');
    expect(window.localStorage.getItem('arcdrop.sidebarWidth')).toBe('376');

    // Dragging past the clamp bounds is capped at the max width
    act(() => {
      handle.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, clientX: 376, clientY: 300 }),
      );
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 900 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 900 }));
    });
    expect(getComputedStyle(root).getPropertyValue('--arcdrop-sidebar-width')).toBe('480px');
    expect(window.localStorage.getItem('arcdrop.sidebarWidth')).toBe('480');
  }, 60_000);

  it('keeps sign-out reachable through the account menu on small screens', async () => {
    const user = userEvent.setup({ delay: null });
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { email: 'mobile@arcdrop.test' },
      }),
    );
    renderAtRoute('/');
    await waitForBootstrapReady();

    // The dedicated Sign out icon is wide-only; the compact toolbar exposes
    // the account menu instead (Settings + Sign out).
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    expect(
      await screen.findByRole('menuitem', { name: APP_STRINGS.accountSettingsItem }),
    ).toBeInTheDocument();
  }, 60_000);

  it('toggles theme from the AppBar ThemeSwitcher', async () => {
    const user = userEvent.setup({ delay: null });
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'admin', email: 'admin@arcdrop.test' },
      }),
    );
    renderAtRoute('/');
    await waitForBootstrapReady();

    await user.click(await screen.findByRole('button', { name: 'Switch theme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Dark' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
  }, 60_000);

  it.each([
    ['/login', 'Sign in'],
    ['/bootstrap', 'Initial setup'],
    ['/claim', 'Claim invite or reset token'],
    ['/s/share-token-1', 'Shared collection'],
  ])(
    'renders unauthenticated lazy route %s with heading %s',
    async (path, heading) => {
      renderAtRoute(path);

      const matches = await screen.findAllByText(heading, {}, { timeout: 30_000 });
      expect(matches.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it.each([
    ['/collections/col-1', 'Reading List'],
    ['/bookmarks/bm-1', 'Bookmark detail'],
    ['/trash', 'Trash'],
    ['/health', 'Library health'],
    ['/portability', 'Import & export'],
    ['/settings', 'Settings'],
    ['/admin', 'Admin'],
  ])(
    'renders authenticated lazy route %s with heading %s',
    async (path, heading) => {
      useAuthStore.getState().setSession(
        makeMockSession({
          user: { role: 'admin', email: 'admin@arcdrop.test' },
        }),
      );
      renderAtRoute(path);
      await waitForBootstrapReady();

      expect(
        await screen.findByRole('heading', { name: heading }, { timeout: 30_000 }),
      ).toBeInTheDocument();
    },
    60_000,
  );
});
