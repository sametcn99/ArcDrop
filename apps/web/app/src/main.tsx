import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './app/AppProviders';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root mount element "#root" was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders />
  </StrictMode>,
);
