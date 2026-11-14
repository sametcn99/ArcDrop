import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/routes';
import { SnackbarHost } from '../../shared/components/SnackbarHost';
import { useAuthStore } from '../../stores/authStore';
import { makeMockBookmark, makeMockSession } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { ThemeController } from '../../theme/ThemeController';

function renderDetailAt(path: string) {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'editor@arcdrop.test' },
    }),
  );

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

describe('BookmarkDetail reminder integration', () => {
  it('round-trips reminder set and clear via DateTimePicker and PUT /bookmarks/:id', async () => {
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('pointer: fine'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    try {
      const capturedReminders: Array<string | null> = [];

      const bookmark = makeMockBookmark({
        id: 'bm-rem',
        reminderAt: null,
        remindedAt: null,
      });

      server.use(
        http.get('*/api/v1/bookmarks/bm-rem', () => HttpResponse.json(bookmark)),
        http.put('*/api/v1/bookmarks/bm-rem', async ({ request }) => {
          const body = (await request.json()) as { reminderAt?: string | null };
          capturedReminders.push(body.reminderAt ?? null);
          return HttpResponse.json({
            ...bookmark,
            reminderAt: body.reminderAt ?? null,
            remindedAt: null,
            updatedAt: '2026-11-14T07:00:00.000Z',
          });
        }),
      );

      renderDetailAt('/bookmarks/bm-rem');

      const section = await screen.findByTestId('bookmark-reminder-section');
      expect(within(section).getByText('No reminder set.')).toBeInTheDocument();

      // Open desktop date-time popover and select day 20
      const chooseBtn = within(section).getByRole('button', { name: /Choose date/i });
      fireEvent.click(chooseBtn);

      const grid = await screen.findByRole('grid');
      const targetDay = within(grid).getByText('20');
      fireEvent.click(targetDay);

      const okBtn = screen.queryByRole('button', { name: 'OK' });
      if (okBtn) {
        fireEvent.click(okBtn);
      }

      const saveReminderBtn = within(section).getByRole('button', { name: 'Set reminder' });
      await waitFor(() => expect(saveReminderBtn).toBeEnabled());
      fireEvent.click(saveReminderBtn);

      await waitFor(() => {
        expect(capturedReminders).toHaveLength(1);
        expect(typeof capturedReminders[0]).toBe('string');
      });
      expect(await within(section).findByText(/Scheduled for:/i)).toBeInTheDocument();

      // Clear reminder
      fireEvent.click(within(section).getByRole('button', { name: 'Clear reminder' }));
      await waitFor(() => {
        expect(capturedReminders).toHaveLength(2);
        expect(capturedReminders[1]).toBeNull();
      });
      expect(await within(section).findByText('No reminder set.')).toBeInTheDocument();
    } finally {
      matchMediaSpy.mockRestore();
    }
  });
});
