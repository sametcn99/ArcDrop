import { createTheme, type PaletteOptions, type Theme } from '@mui/material/styles';
import { components } from './components';
import { buildPaletteOptions, DEFAULT_COLOR_PALETTE_ID, hasColorPalette } from './palettes';
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

function isBuiltInModeTheme(id: string): id is BuiltInThemeId {
  return id === 'light' || id === 'dark';
}

/**
 * Central theme registry (`ThemeId -> theme creator`).
 *
 * The built-in `light` / `dark` entries are Material You themes whose colors
 * come from the user's selected color palette (see `palettes/index.ts`);
 * `getTheme(id, paletteId)` composes them on demand. Dynamically registered
 * themes always use their own creator and ignore the palette selection.
 */
export const THEMES: Record<string, ThemeDefinition> = {
  light: {
    label: 'Light',
    create: () => createAppTheme(buildPaletteOptions('light', DEFAULT_COLOR_PALETTE_ID)),
  },
  dark: {
    label: 'Dark',
    create: () => createAppTheme(buildPaletteOptions('dark', DEFAULT_COLOR_PALETTE_ID)),
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

export function getTheme(id: ThemeId, paletteId: string = DEFAULT_COLOR_PALETTE_ID): Theme {
  const resolvedId = hasTheme(id) ? id : 'light';
  const resolvedPaletteId = hasColorPalette(paletteId) ? paletteId : DEFAULT_COLOR_PALETTE_ID;
  // Only the built-in light/dark themes are palette-driven; dynamic themes are
  // cached under their bare id.
  const cacheKey = isBuiltInModeTheme(resolvedId)
    ? `${resolvedId}::${resolvedPaletteId}`
    : resolvedId;

  const cached = themeCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const definition = THEMES[resolvedId] ?? THEMES.light;
  if (!definition) {
    throw new Error('Default light theme is missing from the theme registry.');
  }
  const created = isBuiltInModeTheme(resolvedId)
    ? createAppTheme(buildPaletteOptions(resolvedId, resolvedPaletteId))
    : definition.create();
  themeCache.set(cacheKey, created);
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

function purgeThemeCache(id: string): void {
  themeCache.delete(id);
  for (const key of themeCache.keys()) {
    if (key.startsWith(`${id}::`)) {
      themeCache.delete(key);
    }
  }
}

/**
 * Dynamically register a theme at runtime (primarily for plugins or tests).
 * Returns an unregister callback that restores the previous registry state.
 */
export function registerTheme(id: string, definition: ThemeDefinition): () => void {
  const previous = Object.prototype.hasOwnProperty.call(THEMES, id) ? THEMES[id] : undefined;
  THEMES[id] = definition;
  purgeThemeCache(id);
  notifyRegistryListeners();

  return () => {
    purgeThemeCache(id);
    if (previous) {
      THEMES[id] = previous;
    } else {
      delete THEMES[id];
    }
    notifyRegistryListeners();
  };
}
