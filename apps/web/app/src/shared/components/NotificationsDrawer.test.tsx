import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { appRoutes } from '../../app/routes';
import type { Notification } from '../../api/schemas/notifications';
import { useAuthStore } from '../../stores/authStore';
import { makeMockNotification, makeMockSession } from '../../test/msw/handlers';
import { server } from '../../test/msw/server';
import { testFakeWsController } from '../../test/setup';
import { waitForLibraryReady } from '../../test/waiters';
import { ThemeController } from '../../theme/ThemeController';
import { SnackbarHost } from './SnackbarHost';

function renderShell() {
  useAuthStore.getState().setSession(
    makeMockSession({
      user: { email: 'notify@arcdrop.test' },
    }),
  );

  const router = createMemoryRouter(appRoutes, {
    initialEntries: ['/'],
  });

  return render(
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>,
  );
}

describe('NotificationsDrawer and live reminder frames', () => {
  it('shows snackbar on WS reminder frame, lists notifications, and marks one or all read', async () => {
    const user = userEvent.setup({ delay: null });
    let notifications: Notification[] = [
      makeMockNotification({
        id: 'notif-1',
        bookmarkId: 'bm-1',
        payload: {
          bookmarkId: 'bm-1',
          title: 'ArcDrop Architecture Guide',
          url: 'https://arcdrop.test/docs/architecture',
          reminderAt: '2026-11-14T12:00:00.000Z',
        },
        readAt: null,
      }),
    ];
    const markReadPayloads: Array<{ ids?: string[]; all?: boolean }> = [];

    server.use(
      http.get('*/api/v1/notifications', () =>
        HttpResponse.json({
          items: notifications,
          totalCount: notifications.length,
          page: 1,
          pageSize: 50,
        }),
      ),
      http.post('*/api/v1/notifications/read', async ({ request }) => {
        const body = (await request.json()) as { ids?: string[]; all?: boolean };
        markReadPayloads.push(body);
        const now = '2026-11-14T12:05:00.000Z';
        if (body.all) {
          notifications = notifications.map((n) => ({ ...n, readAt: n.readAt ?? now }));
          return HttpResponse.json({ updated: notifications.length });
        }
        const idSet = new Set(body.ids ?? []);
        notifications = notifications.map((n) =>
          idSet.has(n.id) ? { ...n, readAt: n.readAt ?? now } : n,
        );
        return HttpResponse.json({ updated: idSet.size });
      }),
    );

    renderShell();
    await waitForLibraryReady();

    await waitFor(
      () => {
        expect(screen.getByTestId('sync-status-indicator')).toHaveAttribute(
          'data-sync-state',
          'live',
        );
      },
      { timeout: 30_000 },
    );
    await waitFor(
      () => {
        expect(screen.getByTestId('notifications-unread-badge')).toHaveTextContent('1');
      },
      { timeout: 30_000 },
    );

    // Inject second notification that server will return when drawer opens after live WS frame
    const liveNotif = makeMockNotification({
      id: 'notif-2',
      bookmarkId: 'bm-2',
      payload: {
        bookmarkId: 'bm-2',
        title: 'MUI Design Tokens Reference',
        url: 'https://mui.com/material-ui/customization/palette/',
        reminderAt: '2026-11-14T12:10:00.000Z',
      },
      readAt: null,
    });
    notifications = [liveNotif, ...notifications];

    act(() => {
      testFakeWsController.latest?.simulateMessage({
        type: 'reminder',
        bookmarkId: 'bm-2',
        title: 'MUI Design Tokens Reference',
      });
    });

    // Snackbar appears immediately
    const reminderToast = await screen.findByText('Reminder: MUI Design Tokens Reference');
    expect(reminderToast).toBeInTheDocument();

    // Badge incremented (1 initial + 1 live frame = 2)
    expect(screen.getByTestId('notifications-unread-badge')).toHaveTextContent('2');

    // Dismiss the reminder snackbar so subsequent toasts are immediately visible
    const alertEl = reminderToast.closest('[role="alert"]');
    if (alertEl) {
      await user.click(within(alertEl as HTMLElement).getByRole('button', { name: 'Close' }));
    }

    // Open notifications drawer
    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();

    const item2 = await screen.findByTestId('notification-item-notif-2');
    expect(within(item2).getByText('MUI Design Tokens Reference')).toBeInTheDocument();

    // Mark single notification read
    await user.click(within(item2).getByRole('button', { name: 'Mark read' }));
    await waitFor(() => {
      expect(markReadPayloads).toContainEqual({ ids: ['notif-2'] });
    });
    await waitFor(() => {
      expect(within(item2).queryByText('Unread')).not.toBeInTheDocument();
    });

    // Mark all remaining notifications read
    await user.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => {
      expect(markReadPayloads).toContainEqual({ all: true });
    });
    expect(await screen.findByText('All notifications marked read.')).toBeInTheDocument();
  }, 60_000);
});
