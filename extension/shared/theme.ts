// Extension theme: MUI themes built from the Material You palette registry
// shared with the web app. The palette DATA is generated from
// apps/web/app/src/theme/palettes/materialYou.ts into theme-palettes.gen.ts
// (`bun --cwd=extension run generate:theme` — same committed-artifact
// pattern as api-types.gen.ts), so the selector here always matches the web
// app's palette list without hand-copied hex values.

import { createTheme, type Theme } from '@mui/material/styles';
import {
  DEFAULT_PALETTE_ID,
  PALETTES,
  SEMANTIC_TONES,
  type PaletteDefinition,
} from './theme-palettes.gen';

export type ThemeMode = 'light' | 'dark';
export type ThemeModeSetting = 'light' | 'dark' | 'system';

export { DEFAULT_PALETTE_ID };
export type { PaletteDefinition };

/** The palettes offered by the options selector (web-app parity). */
export function listPalettes(): readonly PaletteDefinition[] {
  return PALETTES;
}

/** Falls back to the default palette for unknown/stale ids. */
export function resolvePaletteId(paletteId: string | null | undefined): string {
  if (paletteId !== null && paletteId !== undefined && paletteId !== '') {
    const found = PALETTES.find((palette) => palette.id === paletteId);
    if (found) return found.id;
  }
  return DEFAULT_PALETTE_ID;
}

/** 'system' resolves through prefers-color-scheme at render time. */
export function resolveThemeMode(mode: ThemeModeSetting): ThemeMode {
  if (mode === 'light' || mode === 'dark') {
    return mode;
  }
  if (typeof window === 'undefined' || window.matchMedia === undefined) {
    return 'light';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getAppTheme(mode: ThemeMode, paletteId?: string | null): Theme {
  const palette = PALETTES.find((candidate) => candidate.id === resolvePaletteId(paletteId));
  const scheme = palette ? palette.schemes[mode] : PALETTES[0]!.schemes[mode];
  const semantic = SEMANTIC_TONES[mode];
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
