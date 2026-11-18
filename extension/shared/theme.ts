// Extension theme: MUI theme built from the default Material You "violet"
// scheme of the web app (apps/web/app/src/theme/palettes/materialYou.ts).
//
// SYNC NOTE: the extension installs its own dependencies outside the root
// workspace, so the seed scheme below is mirrored BY HAND from
// materialYou.ts (violet, light + dark). When the web palette changes,
// update these hex values to match. E5 can extend this to the full palette
// selection; E1 only needs the default look, light + dark.

import { createTheme, type Theme } from '@mui/material/styles';

export type ThemeMode = 'light' | 'dark';

/** MaterialYouScheme subset the extension consumes (mirrors materialYou.ts). */
interface MirroredScheme {
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
  background: string;
  surface: string;
  onSurface: string;
  onSurfaceVariant: string;
  outlineVariant: string;
}

// Violet scheme — mirrored from apps/web/app/src/theme/palettes/materialYou.ts.
const VIOLET: Record<ThemeMode, MirroredScheme> = {
  light: {
    primary: '#6750A4',
    onPrimary: '#FFFFFF',
    secondary: '#625B71',
    onSecondary: '#FFFFFF',
    background: '#F7F2FA',
    surface: '#FFFFFF',
    onSurface: '#1D1B20',
    onSurfaceVariant: '#49454F',
    outlineVariant: '#CAC4D0',
  },
  dark: {
    primary: '#D0BCFF',
    onPrimary: '#381E72',
    secondary: '#CCC2DC',
    onSecondary: '#332D41',
    background: '#141218',
    surface: '#1D1B20',
    onSurface: '#E6E1E5',
    onSurfaceVariant: '#CAC4D0',
    outlineVariant: '#49454F',
  },
};

// M3 semantic tones — mirrored from MATERIAL_YOU_SEMANTIC in materialYou.ts.
const SEMANTIC: Record<
  ThemeMode,
  { error: string; warning: string; info: string; success: string }
> = {
  light: { error: '#B3261E', warning: '#8A5300', info: '#00639B', success: '#146C2E' },
  dark: { error: '#F2B8B5', warning: '#FFC46E', info: '#9ECAFF', success: '#6DD58C' },
};

export function resolveThemeMode(): ThemeMode {
  if (typeof window === 'undefined' || window.matchMedia === undefined) {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getAppTheme(mode: ThemeMode): Theme {
  const scheme = VIOLET[mode];
  const semantic = SEMANTIC[mode];
  return createTheme({
    palette: {
      mode,
      primary: { main: scheme.primary, contrastText: scheme.onPrimary },
      secondary: { main: scheme.secondary, contrastText: scheme.onSecondary },
      error: { main: semantic.error },
      warning: { main: semantic.warning },
      info: { main: semantic.info },
      success: { main: semantic.success },
      background: { default: scheme.background, paper: scheme.surface },
      text: { primary: scheme.onSurface, secondary: scheme.onSurfaceVariant },
      divider: scheme.outlineVariant,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    },
  });
}
