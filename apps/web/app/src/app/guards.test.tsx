import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../api/client';
import { hasResolvedBaseUrl } from '../api/baseUrl';
import { SnackbarHost } from '../shared/components/SnackbarHost';
import { useAuthStore } from '../stores/authStore';
import { makeMockSession, problemJsonResponse } from '../test/msw/handlers';
import { server } from '../test/msw/server';
import { waitForBootstrapReady, waitForLibraryReady } from '../test/waiters';
import { ThemeController } from '../theme/ThemeController';
import { appRoutes } from './routes';

// The same-origin fallback always resolves on the jsdom http origin; mock the
// resolution so the no-server onboarding redirect can be exercised here.
vi.mock('../api/baseUrl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/baseUrl')>();
  return { ...actual, hasResolvedBaseUrl: vi.fn() };
});
const hasResolvedBaseUrlMock = vi.mocked(hasResolvedBaseUrl);

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
  beforeEach(() => {
    hasResolvedBaseUrlMock.mockReturnValue(true);
  });

  it('redirects unauthenticated requests on protected routes to /login and returns after sign-in', async () => {
    const user = userEvent.setup({ delay: null });
    renderAtPath('/settings');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Email/i), 'alice@arcdrop.test');
    await user.type(screen.getByLabelText(/Password/i), 'password-1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitForBootstrapReady();
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  }, 60_000);

  it('redirects authenticated non-admin users away from /admin to /', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'user', email: 'regular@arcdrop.test' },
      }),
    );

    renderAtPath('/admin');
    await waitForLibraryReady();

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin' })).not.toBeInTheDocument();
  }, 60_000);

  it('allows authenticated admin users to access /admin', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'admin', email: 'admin@arcdrop.test' },
      }),
    );

    renderAtPath('/admin');
    await waitForBootstrapReady();

    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
  }, 60_000);

  it('redirects already-authenticated users from public-only routes to /', async () => {
    useAuthStore.getState().setSession(
      makeMockSession({
        user: { role: 'user', email: 'regular@arcdrop.test' },
      }),
    );

    renderAtPath('/login');
    await waitForLibraryReady();

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
  }, 60_000);

  it('keeps /s/:token accessible without authentication', async () => {
    renderAtPath('/s/public-share-token');

    expect(await screen.findByText('Shared collection')).toBeInTheDocument();
  }, 60_000);

  it('signs out via the AppBar Sign out button, revokes session, and redirects to /login', async () => {
    const user = userEvent.setup({ delay: null });
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
    await waitForLibraryReady();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(loggedOutRefreshToken).toBe('refresh-live');
    expect(apiClient.getAccessToken()).toBeNull();
    expect(apiClient.getRefreshToken()).toBeNull();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  }, 60_000);

  it('routes unauthenticated users to the server onboarding screen when no API base URL is resolved', async () => {
    hasResolvedBaseUrlMock.mockReturnValue(false);

    renderAtPath('/login');

    expect(
      await screen.findByRole('heading', { name: 'Connect to your server' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  }, 60_000);

  it('sends protected-route traffic to onboarding before sign-in when the server is not configured', async () => {
    hasResolvedBaseUrlMock.mockReturnValue(false);

    renderAtPath('/settings');

    expect(
      await screen.findByRole('heading', { name: 'Connect to your server' }),
    ).toBeInTheDocument();
  }, 60_000);

  it('shows the unreachable screen instead of sign-in when the server cannot be reached (plan T5)', async () => {
    hasResolvedBaseUrlMock.mockReturnValue(true);
    useAuthStore.setState({ status: 'unauthenticated', serverUnreachable: true });

    renderAtPath('/settings');

    expect(
      await screen.findByRole('heading', { name: 'Cannot reach your server' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  }, 60_000);

  it('clears the unreachable flag when a session is established again (plan T5)', () => {
    // Recovery semantics without a render dance: the flag is set on boot-time
    // network failure and must clear as soon as a session succeeds again —
    // after which the guards fall back to the normal sign-in/library flow.
    useAuthStore.setState({ serverUnreachable: true });
    useAuthStore.getState().setSession(makeMockSession());
    expect(useAuthStore.getState().serverUnreachable).toBe(false);
  }, 60_000);

  it('restores the persisted session on boot without redirecting to /login', async () => {
    apiClient.clearTokens();
    window.localStorage.setItem('arcdrop.refreshToken', 'persisted-refresh-token');
    useAuthStore.setState({
      user: null,
      status: 'unauthenticated',
      tfaChallenge: null,
      error: null,
    });

    server.use(
      http.post('*/api/v1/auth/refresh', () =>
        HttpResponse.json(
          makeMockSession({
            user: { email: 'restored@arcdrop.test' },
          }),
        ),
      ),
    );

    renderAtPath('/');
    void useAuthStore.getState().restoreSession();

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe('authenticated');
    // The rotated refresh token replaces the persisted one for the next reload.
    expect(window.localStorage.getItem('arcdrop.refreshToken')).toBeTruthy();
  }, 60_000);

  it('clears the persisted token and redirects to /login when restore fails', async () => {
    apiClient.clearTokens();
    window.localStorage.setItem('arcdrop.refreshToken', 'dead-refresh-token');
    useAuthStore.setState({
      user: null,
      status: 'unauthenticated',
      tfaChallenge: null,
      error: null,
    });

    server.use(
      http.post('*/api/v1/auth/refresh', () =>
        problemJsonResponse(401, {
          code: 'UNAUTHORIZED',
          title: 'Unauthorized',
          detail: 'Invalid refresh token',
        }),
      ),
    );

    renderAtPath('/');
    void useAuthStore.getState().restoreSession();

    // The restore settles back to unauthenticated and wipes the dead token...
    await waitFor(() => {
      expect(useAuthStore.getState().status).toBe('unauthenticated');
      expect(window.localStorage.getItem('arcdrop.refreshToken')).toBeNull();
    });
    // ...after which the user lands on the sign-in page.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  }, 60_000);
});
