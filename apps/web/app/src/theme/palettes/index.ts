import type { PaletteOptions } from '@mui/material/styles';
import {
  buildMaterialYouPaletteOptions,
  DEFAULT_COLOR_PALETTE_ID,
  MATERIAL_YOU_PALETTES,
  type MaterialYouPalette,
  type ThemeMode,
} from './materialYou';

export { DEFAULT_COLOR_PALETTE_ID };
export type { ThemeMode } from './materialYou';

/** Picker-facing metadata for one selectable color palette. */
export interface ColorPaletteOption {
  id: string;
  label: string;
  swatch: readonly [string, string];
}

const COLOR_PALETTE_LIST: readonly ColorPaletteOption[] = Object.freeze(
  MATERIAL_YOU_PALETTES.map((palette) => ({
    id: palette.id,
    label: palette.label,
    swatch: palette.swatch,
  })),
);

const COLOR_PALETTES_BY_ID: ReadonlyMap<string, MaterialYouPalette> = new Map(
  MATERIAL_YOU_PALETTES.map((palette) => [palette.id, palette]),
);

/** Stable list of selectable color palettes (safe for context values). */
export function listColorPalettes(): readonly ColorPaletteOption[] {
  return COLOR_PALETTE_LIST;
}

export function hasColorPalette(id: string): boolean {
  return COLOR_PALETTES_BY_ID.has(id);
}

export function getColorPalette(id: string): MaterialYouPalette {
  const palette = COLOR_PALETTES_BY_ID.get(id);
  if (palette) {
    return palette;
  }
  const fallback = COLOR_PALETTES_BY_ID.get(DEFAULT_COLOR_PALETTE_ID);
  if (!fallback) {
    throw new Error('Default color palette is missing from the palette registry.');
  }
  return fallback;
}

/**
 * Resolves the full MUI palette for one mode of one selectable color palette.
 * Unknown palette ids fall back to the default palette.
 */
export function buildPaletteOptions(mode: ThemeMode, paletteId: string): PaletteOptions {
  return buildMaterialYouPaletteOptions(
    mode,
    hasColorPalette(paletteId) ? paletteId : DEFAULT_COLOR_PALETTE_ID,
  );
}
