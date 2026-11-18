import { Navigate, Outlet, useLocation } from 'react-router';
import { hasResolvedBaseUrl } from '../api/baseUrl';
import { useAuthStore } from '../stores/authStore';
import { resolveRedirectTarget } from './redirect';
import { RouteLoader } from './RouteFallbacks';

/**
 * Where unauthenticated users go: the sign-in screen, or — when no API base
 * URL could be resolved (e.g. a fresh Tauri webview with no stored address,
 * env or usable same-origin) — the server-address onboarding screen that must
 * complete first (plan T0).
 */
function unauthenticatedTarget(): string {
  return hasResolvedBaseUrl() ? '/login' : '/server';
}

/**
 * While a persisted session is being restored (page reload), every guard
 * holds off — neither redirecting to /login nor rendering the auth forms —
 * until the refresh attempt settles.
 */
function RestoringFallback() {
  return <RouteLoader />;
}

export function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (status === 'restoring') {
    return <RestoringFallback />;
  }

  if (status !== 'authenticated' || !user) {
    return (
      <Navigate
        to={unauthenticatedTarget()}
        replace
        state={{ from: { pathname: location.pathname, search: location.search } }}
      />
    );
  }

  return <Outlet />;
}

export function RequireAdmin() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (status === 'restoring') {
    return <RestoringFallback />;
  }

  if (status !== 'authenticated' || !user) {
    return (
      <Navigate
        to={unauthenticatedTarget()}
        replace
        state={{ from: { pathname: location.pathname, search: location.search } }}
      />
    );
  }

  if (user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export function PublicOnly() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (status === 'restoring') {
    return <RestoringFallback />;
  }

  // Auth flows (sign-in, bootstrap, claim) all need a configured API server;
  // without a resolvable base URL the onboarding screen comes first.
  if (!hasResolvedBaseUrl()) {
    return <Navigate to="/server" replace />;
  }

  if (status === 'authenticated' && user) {
    const target = resolveRedirectTarget(location.state, '/');
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
