import { createBrowserRouter, RouterProvider } from 'react-router';
import GlobalStyles from '@mui/material/GlobalStyles';
import { useEffect } from 'react';
import { logNativeAppVersion } from '../platform/native';
import { installExternalLinkInterceptor } from '../platform/linkInterceptor';
import { platform } from '../platform';
import { SnackbarHost } from '../shared/components/SnackbarHost';
import { useAuthStore } from '../stores/authStore';
import { ThemeController } from '../theme/ThemeController';
import { appRoutes } from './routes';

const router = createBrowserRouter(appRoutes);

export function AppProviders() {
  const restoreSession = useAuthStore((s) => s.restoreSession);

  // Boot effects (single-flight restore keeps React StrictMode's double
  // effect from replaying the refresh token):
  // - log the native shell version once inside Tauri (T1 bridge check);
  // - mark the body so platform-only CSS (safe-area insets) applies;
  // - route external http(s) anchor clicks to the OS browser in Tauri.
  useEffect(() => {
    logNativeAppVersion();
    if (platform.isTauri) {
      document.body.classList.add('platform-native');
    }
    const uninstallLinkInterceptor = installExternalLinkInterceptor(platform);
    return () => {
      uninstallLinkInterceptor();
    };
  }, []);

  // Kick off the persisted-session restore once on boot; the auth guards
  // render a loader until it settles.
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  return (
    <ThemeController>
      {platform.isTauri ? (
        // Android runs edge-to-edge (MainActivity enableEdgeToEdge): themed
        // app surfaces extend behind the transparent status bar, and these
        // insets keep content clear of cutouts and the gesture nav bar.
        // env() resolves to 0 on desktop platforms, so this is a no-op there.
        <GlobalStyles
          styles={{
            'body.platform-native': { paddingBottom: 'env(safe-area-inset-bottom)' },
          }}
        />
      ) : null}
      <RouterProvider router={router} />
      <SnackbarHost />
    </ThemeController>
  );
}
