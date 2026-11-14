import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  getTheme,
  hasTheme,
  listThemes,
  subscribeThemeRegistry,
  type ThemeId,
  type ThemeOption,
} from './theme';

export const THEME_STORAGE_KEY = 'arcdrop.theme';

export interface ThemeControllerValue {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
  themes: readonly ThemeOption[];
}

const ThemeControllerContext = createContext<ThemeControllerValue | null>(null);

function readStoredThemeId(): ThemeId | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && hasTheme(stored)) {
      return stored;
    }
  } catch {
    // Ignore storage access errors (e.g. private browsing restrictions).
  }
  return null;
}

function writeStoredThemeId(id: ThemeId): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // Ignore storage access errors.
  }
}

function getSystemPreferredThemeId(): ThemeId {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveInitialThemeId(): ThemeId {
  return readStoredThemeId() ?? getSystemPreferredThemeId();
}

export interface ThemeControllerProps {
  children: ReactNode;
}

export function ThemeController({ children }: ThemeControllerProps) {
  const [themeId, setThemeIdState] = useState<ThemeId>(resolveInitialThemeId);
  const themes = useSyncExternalStore(subscribeThemeRegistry, listThemes, listThemes);

  // If the currently active theme is unregistered dynamically, fall back gracefully.
  const effectiveThemeId = hasTheme(themeId) ? themeId : getSystemPreferredThemeId();
  const activeTheme = useMemo(() => getTheme(effectiveThemeId), [effectiveThemeId]);

  const setTheme = useCallback((nextId: ThemeId) => {
    if (!hasTheme(nextId)) {
      return;
    }
    writeStoredThemeId(nextId);
    setThemeIdState(nextId);
  }, []);

  // Follow OS color-scheme changes while the user has not saved an explicit choice.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (readStoredThemeId() !== null) {
        return;
      }
      setThemeIdState(event.matches ? 'dark' : 'light');
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    document.documentElement.dataset.theme = effectiveThemeId;
    document.documentElement.style.colorScheme = activeTheme.palette.mode;
  }, [effectiveThemeId, activeTheme.palette.mode]);

  const contextValue = useMemo<ThemeControllerValue>(
    () => ({
      themeId: effectiveThemeId,
      setTheme,
      themes,
    }),
    [effectiveThemeId, setTheme, themes],
  );

  return (
    <ThemeControllerContext.Provider value={contextValue}>
      <ThemeProvider theme={activeTheme} storageManager={null} disableTransitionOnChange>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </ThemeControllerContext.Provider>
  );
}

export function useThemeController(): ThemeControllerValue {
  const context = useContext(ThemeControllerContext);
  if (!context) {
    throw new Error('useThemeController must be used within a ThemeController.');
  }
  return context;
}
