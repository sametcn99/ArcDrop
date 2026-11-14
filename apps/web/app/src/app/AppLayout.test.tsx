import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useAuthStore } from '../stores/authStore';
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
  it('renders the AppBar, empty Drawer skeleton, and Library placeholder on / when authenticated', async () => {
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
    ['/collections/col-1', 'Collection'],
    ['/bookmarks/bm-1', 'Bookmark detail'],
    ['/trash', 'Trash'],
    ['/health', 'Library health'],
    ['/portability', 'Import & export'],
    ['/settings', 'Settings'],
    ['/admin', 'Administration'],
  ])('renders authenticated lazy placeholder route %s with heading %s', async (path, heading) => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'admin', email: 'admin@arcdrop.test' },
      }),
    );
    renderAtRoute(path);

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });
});
