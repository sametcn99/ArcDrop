import { createBrowserRouter, RouterProvider } from 'react-router';
import { useEffect } from 'react';
import { SnackbarHost } from '../shared/components/SnackbarHost';
import { useAuthStore } from '../stores/authStore';
import { ThemeController } from '../theme/ThemeController';
import { appRoutes } from './routes';

const router = createBrowserRouter(appRoutes);

export function AppProviders() {
  const restoreSession = useAuthStore((s) => s.restoreSession);

  // Kick off the persisted-session restore once on boot; the auth guards
  // render a loader until it settles. Single-flight in the store keeps React
  // StrictMode's double effect from replaying the refresh token.
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  return (
    <ThemeController>
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>
  );
}
