import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { apiClient } from '../api/client';
import { SnackbarHost } from '../shared/components/SnackbarHost';
import { useAuthStore } from '../stores/authStore';
import { makeMockSession } from '../test/msw/handlers';
import { server } from '../test/msw/server';
import { ThemeController } from '../theme/ThemeController';
import { appRoutes } from './routes';

function renderAtPath(path: string) {
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

describe('Route guards & logout flow', () => {
  it('redirects unauthenticated requests on protected routes to /login and returns after sign-in', async () => {
    const user = userEvent.setup();
    renderAtPath('/settings');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Email/i), 'alice@arcdrop.test');
    await user.type(screen.getByLabelText(/Password/i), 'password-1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  });

  it('redirects authenticated non-admin users away from /admin to /', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'user', email: 'regular@arcdrop.test' },
      }),
    );

    renderAtPath('/admin');

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Administration' })).not.toBeInTheDocument();
  });

  it('allows authenticated admin users to access /admin', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'admin', email: 'admin@arcdrop.test' },
      }),
    );

    renderAtPath('/admin');

    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument();
  });

  it('redirects already-authenticated users from public-only routes to /', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'user', email: 'regular@arcdrop.test' },
      }),
    );

    renderAtPath('/login');

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
  });

  it('keeps /s/:token accessible without authentication', async () => {
    renderAtPath('/s/public-share-token');

    expect(await screen.findByRole('heading', { name: 'Shared collection' })).toBeInTheDocument();
  });

  it('signs out via the AppBar Sign out button, revokes session, and redirects to /login', async () => {
    const user = userEvent.setup();
    let loggedOutRefreshToken: string | null = null;

    server.use(
      http.post('*/api/v1/auth/logout', async ({ request }) => {
        const body = (await request.json()) as { refreshToken: string };
        loggedOutRefreshToken = body.refreshToken;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    useAuthStore.getState().setSession(
      makeMockSession({
        user: { email: 'alice@arcdrop.test' },
        accessToken: 'access-live',
        refreshToken: 'refresh-live',
      }),
    );

    renderAtPath('/');

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(loggedOutRefreshToken).toBe('refresh-live');
    expect(apiClient.getAccessToken()).toBeNull();
    expect(apiClient.getRefreshToken()).toBeNull();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});
