import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { BASE_URL_STORAGE_KEY } from '../../api/baseUrl';
import { appRoutes } from '../../app/routes';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';

function renderAtServer() {
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/server'] });
  return render(
    <ThemeController>
      <RouterProvider router={router} />
    </ThemeController>,
  );
}

describe('ServerAddressPage', () => {
  beforeEach(() => {
    window.localStorage.removeItem(BASE_URL_STORAGE_KEY);
    window.localStorage.removeItem('arcdrop.refreshToken');
  });

  it('validates the entered address, stores it, and continues to sign-in', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/openapi.json', () => HttpResponse.json({ openapi: '3.1.0' })));

    renderAtServer();

    await user.type(await screen.findByLabelText(/Server address/i), 'arcdrop.example.com');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.localStorage.getItem(BASE_URL_STORAGE_KEY)).toBe('https://arcdrop.example.com');
  });

  it('shows a distinct error when the server is unreachable and stays on the form', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/openapi.json', () => HttpResponse.error()),
      http.get('*/api/v1/openapi.json', () => HttpResponse.error()),
    );

    renderAtServer();

    await user.type(await screen.findByLabelText(/Server address/i), 'down.example.com');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach the server');
    expect(screen.getByRole('heading', { name: 'Connect to your server' })).toBeInTheDocument();
    expect(window.localStorage.getItem(BASE_URL_STORAGE_KEY)).toBeNull();
  });

  it('shows a distinct error when the server is not an ArcDrop server', async () => {
    const user = userEvent.setup();
    server.use(http.get('*/openapi.json', () => HttpResponse.json({ openapi: '2.0' })));

    renderAtServer();

    await user.type(await screen.findByLabelText(/Server address/i), 'notarcdrop.example.com');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('does not look like an ArcDrop server');
    expect(window.localStorage.getItem(BASE_URL_STORAGE_KEY)).toBeNull();
  });
});
