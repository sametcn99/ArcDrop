import { CssBaseline, ThemeProvider } from '@mui/material';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getAppTheme, resolveThemeMode } from '../shared/theme';
import { chromeStorageLocal, readVault } from '../shared/vault';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Popup root element is missing');
}

void (async (): Promise<void> => {
  // Theme comes from the vault (E5 options); hydration before the first
  // paint avoids a flash of the wrong mode.
  const vault = await readVault(chromeStorageLocal());
  createRoot(container).render(
    <ThemeProvider
      theme={getAppTheme(resolveThemeMode(vault.settings.themeMode), vault.settings.themePaletteId)}
    >
      <CssBaseline />
      <App />
    </ThemeProvider>,
  );
})();
