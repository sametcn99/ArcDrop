import { createBrowserRouter, createHashRouter, RouterProvider } from 'react-router';
import GlobalStyles from '@mui/material/GlobalStyles';
import { useEffect } from 'react';
import { logNativeAppVersion } from '../platform/native';
import { installExternalLinkInterceptor } from '../platform/linkInterceptor';
import { platform } from '../platform';
import { SnackbarHost } from '../shared/components/SnackbarHost';
import { useAuthStore } from '../stores/authStore';
import { useShareFileStore } from '../stores/shareFileStore';
import { useUiStore } from '../stores/uiStore';
import { APP_STRINGS } from './strings';
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

  // Share-target & deep-link stream (plans T3/T4): Android ACTION_SEND
  // shares and desktop arcdrop://add links both land on the existing
  // quick-add route — when signed out, the standard redirect machinery
  // preserves the target through the auth flow. Shared FILES (T4) are read
  // from the app cache via plugin-fs and handed to the upload dialog through
  // the share-file store.
  useEffect(() => {
    return platform.onShareTarget((payload) => {
      if (payload.kind === 'url') {
        router.navigate(`/quick-add?url=${encodeURIComponent(payload.url)}`);
        return;
      }
      if (payload.kind === 'file') {
        void (async () => {
          const file = await platform.readLocalFile(payload.path, payload.fileName, payload.mime);
          if (!file) {
            useUiStore.getState().enqueueSnackbar({
              message: APP_STRINGS.shareFileReadError,
              severity: 'error',
            });
            return;
          }
          useShareFileStore.getState().setPendingFile(file);
          router.navigate('/');
        })();
        return;
      }
      useUiStore.getState().enqueueSnackbar({
        message:
          payload.kind === 'file-too-large'
            ? APP_STRINGS.shareFileTooLarge
            : APP_STRINGS.shareFileReadError,
        severity: 'warning',
      });
    });
  }, []);

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
