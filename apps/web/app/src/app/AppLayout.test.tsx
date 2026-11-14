import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
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

describe('AppLayout and placeholder router shell', () => {
  it('renders the AppBar, empty Drawer skeleton, and Library placeholder on /', async () => {
    renderAtRoute('/');

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getAllByText('ArcDrop').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Collections').length).toBeGreaterThan(0);
  });

  it('toggles theme from the AppBar ThemeSwitcher', async () => {
    const user = userEvent.setup();
    renderAtRoute('/');

    await user.click(screen.getByRole('button', { name: 'Switch theme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Dark' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it.each([
    ['/login', 'Sign in'],
    ['/bootstrap', 'Initial setup'],
    ['/claim', 'Claim invite or reset token'],
    ['/collections/col-1', 'Collection'],
    ['/bookmarks/bm-1', 'Bookmark detail'],
    ['/trash', 'Trash'],
    ['/health', 'Library health'],
    ['/portability', 'Import & export'],
    ['/settings', 'Settings'],
    ['/admin', 'Administration'],
    ['/s/share-token-1', 'Shared collection'],
  ])('renders lazy placeholder route %s with heading %s', async (path, heading) => {
    renderAtRoute(path);

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });
});
