import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import { makeMockSession, problemJsonResponse } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';

function renderAtClaim(path = '/claim?token=invite-token-123') {
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

describe('ClaimPage', () => {
  it('reads token from URL, claims account, and navigates to library', async () => {
    const user = userEvent.setup();
    let capturedBody: Record<string, unknown> | null = null;

    server.use(
      http.post('*/api/v1/auth/claim', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          makeMockSession({
            user: { email: 'invited@arcdrop.test' },
            accessToken: 'access-claimed',
            refreshToken: 'refresh-claimed',
          }),
          { status: 201 },
        );
      }),
    );

    renderAtClaim('/claim?token=invite-token-123');

    const tokenInput = await screen.findByLabelText(/Invite or reset token/i);
    expect(tokenInput).toHaveValue('invite-token-123');

    await user.type(screen.getByLabelText(/^New password/i), 'fresh-user-password');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'fresh-user-password');
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }));

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(capturedBody).toEqual({
      token: 'invite-token-123',
      password: 'fresh-user-password',
    });
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('displays expired-token error state when API returns 410 GONE', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('*/api/v1/auth/claim', () =>
        problemJsonResponse(410, {
          code: 'GONE',
          title: 'Gone',
          detail: 'Token is expired',
        }),
      ),
    );

    renderAtClaim('/claim?token=expired-token-999');

    await user.type(await screen.findByLabelText(/^New password/i), 'fresh-user-password');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'fresh-user-password');
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Token expired or already used');
    expect(alert).toHaveTextContent('Token is expired');
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('displays error message when API returns 401 for unknown token', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('*/api/v1/auth/claim', () =>
        problemJsonResponse(401, {
          code: 'UNAUTHORIZED',
          title: 'Unauthorized',
          detail: 'Invalid invite or reset token',
        }),
      ),
    );

    renderAtClaim('/claim');

    await user.type(await screen.findByLabelText(/Invite or reset token/i), 'bogus-token');
    await user.type(screen.getByLabelText(/^New password/i), 'fresh-user-password');
    await user.type(screen.getByLabelText(/Confirm new password/i), 'fresh-user-password');
    await user.click(screen.getByRole('button', { name: 'Set password and sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid invite or reset token');
  });
});
