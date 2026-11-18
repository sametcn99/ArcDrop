import { describe, expect, it } from 'bun:test';
import { getAppTheme, listPalettes, resolvePaletteId, resolveThemeMode } from './theme';

describe('theme palette registry', () => {
  it('mirrors the web app palette list (11 Material You palettes)', () => {
    const palettes = listPalettes();
    expect(palettes.length).toBe(11);
    expect(palettes.map((palette) => palette.id)).toContain('violet');
    expect(palettes.map((palette) => palette.id)).toContain('amoled');
  });

  it('resolves known ids and falls back to the default for unknown ones', () => {
    expect(resolvePaletteId('ocean')).toBe('ocean');
    expect(resolvePaletteId('stale-palette-from-storage')).toBe('violet');
    expect(resolvePaletteId(null)).toBe('violet');
  });
});

describe('getAppTheme', () => {
  it('builds themes for both modes without throwing', () => {
    expect(getAppTheme('light', 'violet')).toBeDefined();
    expect(getAppTheme('dark', 'ocean')).toBeDefined();
  });
});

describe('resolveThemeMode', () => {
  it('passes explicit modes through', () => {
    expect(resolveThemeMode('light')).toBe('light');
    expect(resolveThemeMode('dark')).toBe('dark');
  });
});
