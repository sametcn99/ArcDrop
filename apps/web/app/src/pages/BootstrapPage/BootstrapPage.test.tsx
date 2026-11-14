import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import { problemJsonResponse } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';

function renderAtBootstrap() {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/bootstrap'],
  });
  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('BootstrapPage', () => {
  it('creates the first admin user and navigates to library', async () => {
    const user = userEvent.setup();
    renderAtBootstrap();

    await user.type(await screen.findByLabelText(/Admin email/i), 'admin@arcdrop.test');
    await user.type(screen.getByLabelText(/^Password/i), 'super-secret-password');
    await user.type(screen.getByLabelText(/Confirm password/i), 'super-secret-password');
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(useAuthStore.getState().user?.role).toBe('admin');
    expect(useAuthStore.getState().user?.email).toBe('admin@arcdrop.test');
  });

  it('enforces bootstrap-only-once guard when API returns 409 CONFLICT', async () => {
    const user = userEvent.setup();

    server.use(
      http.post('*/api/v1/auth/bootstrap', () =>
        problemJsonResponse(409, {
          code: 'CONFLICT',
          title: 'Conflict',
          detail: 'This instance already has a user — bootstrap is closed',
        }),
      ),
    );

    renderAtBootstrap();

    await user.type(await screen.findByLabelText(/Admin email/i), 'admin@arcdrop.test');
    await user.type(screen.getByLabelText(/^Password/i), 'super-secret-password');
    await user.type(screen.getByLabelText(/Confirm password/i), 'super-secret-password');
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    expect(await screen.findByText('Setup already completed')).toBeInTheDocument();
    expect(
      screen.getByText('This instance already has a user — bootstrap is closed'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('button', { name: 'Create admin account' })).not.toBeInTheDocument();
  });

  it('validates that password and confirmation match before submitting', async () => {
    const user = userEvent.setup();
    renderAtBootstrap();

    await user.type(await screen.findByLabelText(/Admin email/i), 'admin@arcdrop.test');
    await user.type(screen.getByLabelText(/^Password/i), 'super-secret-password');
    await user.type(screen.getByLabelText(/Confirm password/i), 'different-password');
    await user.click(screen.getByRole('button', { name: 'Create admin account' }));

    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});
