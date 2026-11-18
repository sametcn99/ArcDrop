import { Navigate, Outlet, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { hasResolvedBaseUrl } from '../api/baseUrl';
import ServerUnreachablePage from '../pages/ServerUnreachablePage';
import { useAuthStore } from '../stores/authStore';
import { resolveRedirectTarget } from './redirect';
import { RouteLoader } from './RouteFallbacks';

/**
 * Where unauthenticated users go: the sign-in screen, or — when no API base
 * URL could be resolved (e.g. a fresh Tauri webview with no stored address,
 * env or usable same-origin) — the server-address onboarding screen that must
 * complete first (plan T0). When the configured server itself is unreachable
 * (plan T5), the dedicated offline screen takes over instead.
 */
function unauthenticatedTarget(): string {
  return hasResolvedBaseUrl() ? '/login' : '/server';
}

/**
 * Renders the boot-time offline screen when the configured server is
 * unreachable; otherwise renders `children`.
 */
function UnreachableGate({ children }: { children: ReactNode }): ReactNode {
  const serverUnreachable = useAuthStore((s) => s.serverUnreachable);
  if (serverUnreachable) {
    return <ServerUnreachablePage />;
  }
  return children;
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
      <UnreachableGate>
        <Navigate
          to={unauthenticatedTarget()}
          replace
          state={{ from: { pathname: location.pathname, search: location.search } }}
        />
      </UnreachableGate>
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
      <UnreachableGate>
        <Navigate
          to={unauthenticatedTarget()}
          replace
          state={{ from: { pathname: location.pathname, search: location.search } }}
        />
      </UnreachableGate>
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
  const serverUnreachable = useAuthStore((s) => s.serverUnreachable);
  const location = useLocation();

  if (status === 'restoring') {
    return <RestoringFallback />;
  }

  // Auth flows (sign-in, bootstrap, claim) all need a configured API server;
  // without a resolvable base URL the onboarding screen comes first — and
  // when the configured server is unreachable, the offline screen takes over
  // until the server answers again.
  if (!hasResolvedBaseUrl()) {
    return <Navigate to="/server" replace />;
  }
  if (serverUnreachable) {
    return <ServerUnreachablePage />;
  }

  if (status === 'authenticated' && user) {
    const target = resolveRedirectTarget(location.state, '/');
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
