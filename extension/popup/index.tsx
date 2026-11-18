import { CssBaseline, ThemeProvider } from '@mui/material';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getAppTheme, resolveThemeMode } from '../shared/theme';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Popup root element is missing');
}

createRoot(container).render(
  <ThemeProvider theme={getAppTheme(resolveThemeMode())}>
    <CssBaseline />
    <App />
  </ThemeProvider>,
);
