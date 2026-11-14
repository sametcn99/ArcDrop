import { lazy, Suspense, type ReactNode } from 'react';
import { type RouteObject } from 'react-router';
import { AppLayout } from './AppLayout';
import { PublicOnly, RequireAdmin, RequireAuth } from './guards';
import { NotFoundPage, RouteLoader } from './RouteFallbacks';

const LoginPage = lazy(() => import('../pages/LoginPage'));
const BootstrapPage = lazy(() => import('../pages/BootstrapPage'));
const ClaimPage = lazy(() => import('../pages/ClaimPage'));
const LibraryPage = lazy(() => import('../pages/LibraryPage'));
const CollectionPage = lazy(() => import('../pages/CollectionPage'));
const TrashPage = lazy(() => import('../pages/TrashPage'));
const BookmarkDetailPage = lazy(() => import('../pages/BookmarkDetail'));
const HealthPage = lazy(() => import('../pages/HealthPage'));
const PortabilityPage = lazy(() => import('../pages/PortabilityPage'));
const SettingsPage = lazy(() => import('../pages/SettingsPage'));
const AdminPage = lazy(() => import('../pages/AdminPage'));
const PublicSharePage = lazy(() => import('../pages/PublicSharePage'));

function withSuspense(node: ReactNode): ReactNode {
  return <Suspense fallback={<RouteLoader />}>{node}</Suspense>;
}

export const appRoutes: RouteObject[] = [
  {
    element: <PublicOnly />,
    children: [
      {
        path: '/login',
        element: withSuspense(<LoginPage />),
      },
      {
        path: '/bootstrap',
        element: withSuspense(<BootstrapPage />),
      },
      {
        path: '/claim',
        element: withSuspense(<ClaimPage />),
      },
    ],
  },
  {
    path: '/s/:token',
    element: withSuspense(<PublicSharePage />),
  },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: withSuspense(<LibraryPage />),
          },
          {
            path: 'collections/:collectionId',
            element: withSuspense(<CollectionPage />),
          },
          {
            path: 'bookmarks/:bookmarkId',
            element: withSuspense(<BookmarkDetailPage />),
          },
          {
            path: 'trash',
            element: withSuspense(<TrashPage />),
          },
          {
            path: 'health',
            element: withSuspense(<HealthPage />),
          },
          {
            path: 'portability',
            element: withSuspense(<PortabilityPage />),
          },
          {
            path: 'settings',
            element: withSuspense(<SettingsPage />),
          },
          {
            element: <RequireAdmin />,
            children: [
              {
                path: 'admin',
                element: withSuspense(<AdminPage />),
              },
            ],
          },
          {
            path: '*',
            element: <NotFoundPage />,
          },
        ],
      },
    ],
  },
];
