import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../api/client';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import { makeMockSession, problemJsonResponse } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';

function renderAtLogin(
  initialEntries: Array<string | { pathname: string; state?: unknown }> = ['/login'],
) {
  const router = createMemoryRouter(appRoutes, { initialEntries });
  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('LoginPage', () => {
  it('logs in with valid credentials, keeps tokens in memory only, and navigates to library', async () => {
    const user = userEvent.setup();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    renderAtLogin();

    await user.type(await screen.findByLabelText(/Email/i), 'alice@arcdrop.test');
    await user.type(screen.getByLabelText(/Password/i), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user?.email).toBe('alice@arcdrop.test');
    expect(apiClient.getAccessToken()).toBe('access-token-login');
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('completes two-step TOTP login when server responds with 401 TOTP_REQUIRED', async () => {
    const user = userEvent.setup();
    let capturedTfaBody: Record<string, unknown> | null = null;

    server.use(
      http.post('*/api/v1/auth/login', () =>
        problemJsonResponse(401, {
          code: 'TOTP_REQUIRED',
          title: 'Unauthorized',
          detail: 'Two-factor authentication code required',
          challenge: 'tfa-challenge-token',
          expiresAt: '2026-11-14T16:00:00.000Z',
        }),
      ),
      http.post('*/api/v1/auth/login/tfa', async ({ request }) => {
        capturedTfaBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          makeMockSession({
            user: { email: 'alice@arcdrop.test', totpEnabled: true },
            accessToken: 'access-token-tfa-complete',
            refreshToken: 'refresh-token-tfa-complete',
          }),
          { status: 201 },
        );
      }),
    );

    renderAtLogin();

    await user.type(await screen.findByLabelText(/Email/i), 'alice@arcdrop.test');
    await user.type(screen.getByLabelText(/Password/i), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-factor authentication' }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Authentication code/i), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(capturedTfaBody).toEqual({
      challenge: 'tfa-challenge-token',
      code: '123456',
    });
    expect(apiClient.getAccessToken()).toBe('access-token-tfa-complete');
  });

  it('renders error alert when wrong TOTP code is submitted and supports recovery code mode', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('*/api/v1/auth/login', () =>
        problemJsonResponse(401, {
          code: 'TOTP_REQUIRED',
          title: 'Unauthorized',
          detail: 'Two-factor authentication code required',
          challenge: 'tfa-challenge-token',
          expiresAt: '2026-11-14T16:00:00.000Z',
        }),
      ),
      http.post('*/api/v1/auth/login/tfa', async ({ request }) => {
        const body = (await request.json()) as { code?: string; recoveryCode?: string };
        if (body.code === '000000') {
          return problemJsonResponse(401, {
            code: 'UNAUTHORIZED',
            title: 'Unauthorized',
            detail: 'Invalid two-factor authentication or recovery code',
          });
        }
        return HttpResponse.json(
          makeMockSession({
            user: { email: 'alice@arcdrop.test', totpEnabled: true },
            accessToken: 'access-recovery-ok',
          }),
          { status: 201 },
        );
      }),
    );

    renderAtLogin();

    await user.type(await screen.findByLabelText(/Email/i), 'alice@arcdrop.test');
    await user.type(screen.getByLabelText(/Password/i), 'correct-horse-battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(
      await screen.findByRole('heading', { name: 'Two-factor authentication' }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Authentication code/i), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid two-factor authentication or recovery code');

    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    await user.type(screen.getByLabelText(/Recovery code/i), 'a1b2c-d3e4f');
    await user.click(screen.getByRole('button', { name: 'Verify and sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
    });
  });

  it('renders an error alert on invalid credentials', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('*/api/v1/auth/login', () =>
        problemJsonResponse(401, {
          code: 'UNAUTHORIZED',
          title: 'Unauthorized',
          detail: 'Invalid email or password',
        }),
      ),
    );

    renderAtLogin();

    await user.type(await screen.findByLabelText(/Email/i), 'alice@arcdrop.test');
    await user.type(screen.getByLabelText(/Password/i), 'wrong-password-1');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid email or password');
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});
