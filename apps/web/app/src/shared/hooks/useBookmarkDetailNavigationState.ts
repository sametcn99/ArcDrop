import { useMemo } from 'react';
import { useLocation } from 'react-router';

/**
 * Router state passed when navigating to a bookmark detail so the list view
 * stays mounted behind the detail drawer (background-location pattern — see
 * AppLayout's BackgroundLocationRoutes).
 *
 * Memoized so every memoized list row receiving it as a prop keeps a stable
 * reference between renders while the location is unchanged.
 */
export function useBookmarkDetailNavigationState() {
  const location = useLocation();
  return useMemo(() => ({ background: location }) as const, [location]);
}
