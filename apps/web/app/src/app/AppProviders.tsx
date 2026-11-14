import { createBrowserRouter, RouterProvider } from 'react-router';
import { ThemeController } from '../theme/ThemeController';
import { appRoutes } from './routes';

const router = createBrowserRouter(appRoutes);

export function AppProviders() {
  return (
    <ThemeController>
      <RouterProvider router={router} />
    </ThemeController>
  );
}
