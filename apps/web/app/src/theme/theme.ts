import { createTheme, type PaletteOptions, type Theme } from '@mui/material/styles';
import { components } from './components';
import { darkPalette } from './palettes/dark';
import { lightPalette } from './palettes/light';
import { shape } from './shape';
import { typography } from './typography';

declare module '@mui/material/styles' {
  interface CssThemeVariables {
    enabled: true;
  }
}

export type BuiltInThemeId = 'light' | 'dark';
export type ThemeId = BuiltInThemeId | (string & {});

export type ThemeCreator = () => Theme;

export interface ThemeDefinition {
  label: string;
  create: ThemeCreator;
}

export interface ThemeOption {
  id: ThemeId;
  label: string;
}

export function createAppTheme(palette: PaletteOptions): Theme {
  return createTheme({
    cssVariables: true,
    palette,
    typography,
    shape,
    components,
  });
}

/**
 * Central theme registry (`ThemeId -> theme creator`).
 * Adding a new theme requires only a palette file in `src/theme/palettes/`
 * and one entry in this map.
 */
export const THEMES: Record<string, ThemeDefinition> = {
  light: {
    label: 'Light',
    create: () => createAppTheme(lightPalette),
  },
  dark: {
    label: 'Dark',
    create: () => createAppTheme(darkPalette),
  },
};

const themeCache = new Map<string, Theme>();
const registryListeners = new Set<() => void>();
let cachedThemeList: readonly ThemeOption[] = buildThemeList();

function buildThemeList(): readonly ThemeOption[] {
  return Object.entries(THEMES).map(([id, entry]) => ({
    id,
    label: entry.label,
  }));
}

function notifyRegistryListeners(): void {
  cachedThemeList = buildThemeList();
  for (const listener of registryListeners) {
    listener();
  }
}

export function hasTheme(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(THEMES, id);
}

export function getTheme(id: ThemeId): Theme {
  const resolvedId = hasTheme(id) ? id : 'light';
  const cached = themeCache.get(resolvedId);
  if (cached) {
    return cached;
  }
  const definition = THEMES[resolvedId] ?? THEMES.light;
  if (!definition) {
    throw new Error('Default light theme is missing from the theme registry.');
  }
  const created = definition.create();
  themeCache.set(resolvedId, created);
  return created;
}

export function listThemes(): readonly ThemeOption[] {
  return cachedThemeList;
}

export function subscribeThemeRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/**
 * Dynamically register a theme at runtime (primarily for plugins or tests).
 * Returns an unregister callback that restores the previous registry state.
 */
export function registerTheme(id: string, definition: ThemeDefinition): () => void {
  const previous = Object.prototype.hasOwnProperty.call(THEMES, id) ? THEMES[id] : undefined;
  THEMES[id] = definition;
  themeCache.delete(id);
  notifyRegistryListeners();

  return () => {
    themeCache.delete(id);
    if (previous) {
      THEMES[id] = previous;
    } else {
      delete THEMES[id];
    }
    notifyRegistryListeners();
  };
}
