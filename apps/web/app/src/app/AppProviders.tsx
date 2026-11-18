import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router';
import { useEffect } from 'react';
import { SnackbarHost } from '../shared/components/SnackbarHost';
import { useAuthStore } from '../stores/authStore';
import { ThemeController } from '../theme/ThemeController';
import { appRoutes } from './routes';

// The browser-extension embed (E3, ARCDROP_EMBED=extension build) serves the
// app from chrome-extension://…/pages/app/index.html — history-mode URLs
// have no backing file there, so the embed build routes in hash mode. The
// regular web build stays on the browser history router.
const router =
  import.meta.env.VITE_ROUTER_MODE === 'hash'
    ? createHashRouter(appRoutes)
    : createBrowserRouter(appRoutes);

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
