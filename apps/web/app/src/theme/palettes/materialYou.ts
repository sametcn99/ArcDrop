import type { PaletteOptions } from '@mui/material/styles';

export type ThemeMode = 'light' | 'dark';

/**
 * One Material You color scheme (a full set of M3 tonal roles) for a single
 * mode. Values follow the Material 3 tonal-palette conventions: `primary` is
 * tone 40 (light) / tone 80 (dark), `background` is the tinted neutral
 * surface, `surface` is the card/sheet color, and `outlineVariant` doubles as
 * the divider color.
 */
export interface MaterialYouScheme {
  primary: string;
  onPrimary: string;
  primaryBright: string;
  primaryDeep: string;
  secondary: string;
  onSecondary: string;
  secondaryBright: string;
  secondaryDeep: string;
  background: string;
  surface: string;
  onSurface: string;
  onSurfaceVariant: string;
  outlineVariant: string;
}

/**
 * A selectable color palette: a named seed color expanded into full light and
 * dark M3 schemes. Switching palettes changes only the colors — shape,
 * typography, and component styling stay untouched.
 */
export interface MaterialYouPalette {
  id: string;
  label: string;
  /** Two representative colors (light-mode + dark-mode primary) for UI swatches. */
  swatch: readonly [string, string];
  schemes: Record<ThemeMode, MaterialYouScheme>;
}

/**
 * Semantic colors are M3 baseline values shared by every palette so status
 * tones stay consistent regardless of the selected accent color.
 */
export const MATERIAL_YOU_SEMANTIC: Record<
  ThemeMode,
  { error: string; warning: string; info: string; success: string }
> = {
  light: {
    error: '#B3261E',
    warning: '#8A5300',
    info: '#00639B',
    success: '#146C2E',
  },
  dark: {
    error: '#F2B8B5',
    warning: '#FFC46E',
    info: '#9ECAFF',
    success: '#6DD58C',
  },
};

function violet(): MaterialYouPalette {
  return {
    id: 'violet',
    label: 'Violet',
    swatch: ['#6750A4', '#D0BCFF'],
    schemes: {
      light: {
        primary: '#6750A4',
        onPrimary: '#FFFFFF',
        primaryBright: '#8265C6',
        primaryDeep: '#524298',
        secondary: '#625B71',
        onSecondary: '#FFFFFF',
        secondaryBright: '#837D93',
        secondaryDeep: '#4E4859',
        background: '#F7F2FA',
        surface: '#FFFFFF',
        onSurface: '#1D1B20',
        onSurfaceVariant: '#49454F',
        outlineVariant: '#CAC4D0',
      },
      dark: {
        primary: '#D0BCFF',
        onPrimary: '#381E72',
        primaryBright: '#DCC9FF',
        primaryDeep: '#B69DF2',
        secondary: '#CCC2DC',
        onSecondary: '#332D41',
        secondaryBright: '#D8D0E6',
        secondaryDeep: '#B4AAC6',
        background: '#141218',
        surface: '#1D1B20',
        onSurface: '#E6E1E5',
        onSurfaceVariant: '#CAC4D0',
        outlineVariant: '#49454F',
      },
    },
  };
}

function ocean(): MaterialYouPalette {
  return {
    id: 'ocean',
    label: 'Ocean',
    swatch: ['#0B57D0', '#A8C7FA'],
    schemes: {
      light: {
        primary: '#0B57D0',
        onPrimary: '#FFFFFF',
        primaryBright: '#4781D9',
        primaryDeep: '#0A46A8',
        secondary: '#565E71',
        onSecondary: '#FFFFFF',
        secondaryBright: '#757D90',
        secondaryDeep: '#454C5D',
        background: '#F1F5FB',
        surface: '#FFFFFF',
        onSurface: '#191C20',
        onSurfaceVariant: '#44474E',
        outlineVariant: '#C4C6D0',
      },
      dark: {
        primary: '#A8C7FA',
        onPrimary: '#062E6F',
        primaryBright: '#C2D9FC',
        primaryDeep: '#86ABF0',
        secondary: '#BEC6DC',
        onSecondary: '#283041',
        secondaryBright: '#CAD1E5',
        secondaryDeep: '#A6AEC4',
        background: '#111318',
        surface: '#1B1E24',
        onSurface: '#E2E2E9',
        onSurfaceVariant: '#C4C6D0',
        outlineVariant: '#44474E',
      },
    },
  };
}

function forest(): MaterialYouPalette {
  return {
    id: 'forest',
    label: 'Forest',
    swatch: ['#146C2E', '#6DD58C'],
    schemes: {
      light: {
        primary: '#146C2E',
        onPrimary: '#FFFFFF',
        primaryBright: '#2E8442',
        primaryDeep: '#0F5223',
        secondary: '#52634F',
        onSecondary: '#FFFFFF',
        secondaryBright: '#6F806C',
        secondaryDeep: '#41503F',
        background: '#F2F7F1',
        surface: '#FFFFFF',
        onSurface: '#181D18',
        onSurfaceVariant: '#414940',
        outlineVariant: '#C1C9BD',
      },
      dark: {
        primary: '#6DD58C',
        onPrimary: '#003914',
        primaryBright: '#8DE2A6',
        primaryDeep: '#55BC73',
        secondary: '#B9CCB4',
        onSecondary: '#253623',
        secondaryBright: '#C6D7C1',
        secondaryDeep: '#A2B49D',
        background: '#101510',
        surface: '#1A201B',
        onSurface: '#E0E4DC',
        onSurfaceVariant: '#C1C9BD',
        outlineVariant: '#414940',
      },
    },
  };
}

function sunset(): MaterialYouPalette {
  return {
    id: 'sunset',
    label: 'Sunset',
    swatch: ['#8F5000', '#FFB877'],
    schemes: {
      light: {
        primary: '#8F5000',
        onPrimary: '#FFFFFF',
        primaryBright: '#AF6D24',
        primaryDeep: '#744000',
        secondary: '#74593F',
        onSecondary: '#FFFFFF',
        secondaryBright: '#8F7358',
        secondaryDeep: '#5F4934',
        background: '#F8F3EC',
        surface: '#FFFFFF',
        onSurface: '#1E1B16',
        onSurfaceVariant: '#4D4639',
        outlineVariant: '#D0C5B5',
      },
      dark: {
        primary: '#FFB877',
        onPrimary: '#4A2800',
        primaryBright: '#FFCB96',
        primaryDeep: '#E0A263',
        secondary: '#E2C0A3',
        onSecondary: '#412C16',
        secondaryBright: '#E9CCB2',
        secondaryDeep: '#C8A98C',
        background: '#171210',
        surface: '#201A17',
        onSurface: '#EDE1D4',
        onSurfaceVariant: '#D0C5B5',
        outlineVariant: '#4D4639',
      },
    },
  };
}

function rose(): MaterialYouPalette {
  return {
    id: 'rose',
    label: 'Rose',
    swatch: ['#A62E75', '#FFB0D8'],
    schemes: {
      light: {
        primary: '#A62E75',
        onPrimary: '#FFFFFF',
        primaryBright: '#BE5190',
        primaryDeep: '#871F5C',
        secondary: '#6E5760',
        onSecondary: '#FFFFFF',
        secondaryBright: '#8A737C',
        secondaryDeep: '#58474E',
        background: '#F9F2F6',
        surface: '#FFFFFF',
        onSurface: '#1F191D',
        onSurfaceVariant: '#4D444C',
        outlineVariant: '#CFC4CC',
      },
      dark: {
        primary: '#FFB0D8',
        onPrimary: '#5B0037',
        primaryBright: '#FFC6E3',
        primaryDeep: '#E293BF',
        secondary: '#E0BFCB',
        onSecondary: '#3A2B32',
        secondaryBright: '#E9CCD6',
        secondaryDeep: '#C7A7B3',
        background: '#171214',
        surface: '#201A1D',
        onSurface: '#EEDDE4',
        onSurfaceVariant: '#D0C4CB',
        outlineVariant: '#4D444C',
      },
    },
  };
}

function crimson(): MaterialYouPalette {
  return {
    id: 'crimson',
    label: 'Crimson',
    swatch: ['#B3261E', '#F2B8B5'],
    schemes: {
      light: {
        primary: '#B3261E',
        onPrimary: '#FFFFFF',
        primaryBright: '#CC544B',
        primaryDeep: '#961E19',
        secondary: '#77565A',
        onSecondary: '#FFFFFF',
        secondaryBright: '#926F73',
        secondaryDeep: '#614448',
        background: '#F9F2F1',
        surface: '#FFFFFF',
        onSurface: '#201A19',
        onSurfaceVariant: '#524341',
        outlineVariant: '#D7C2C0',
      },
      dark: {
        primary: '#F2B8B5',
        onPrimary: '#601410',
        primaryBright: '#F6CBC9',
        primaryDeep: '#DB9C99',
        secondary: '#E4BDB7',
        onSecondary: '#422B28',
        secondaryBright: '#ECCDC8',
        secondaryDeep: '#CBA4A0',
        background: '#191211',
        surface: '#221918',
        onSurface: '#EDE0DE',
        onSurfaceVariant: '#D7C2C0',
        outlineVariant: '#524341',
      },
    },
  };
}

function teal(): MaterialYouPalette {
  return {
    id: 'teal',
    label: 'Teal',
    swatch: ['#006A60', '#55DBC9'],
    schemes: {
      light: {
        primary: '#006A60',
        onPrimary: '#FFFFFF',
        primaryBright: '#1F887C',
        primaryDeep: '#005048',
        secondary: '#4A635F',
        onSecondary: '#FFFFFF',
        secondaryBright: '#677E7A',
        secondaryDeep: '#3A4F4C',
        background: '#EFF6F4',
        surface: '#FFFFFF',
        onSurface: '#171D1C',
        onSurfaceVariant: '#3F4947',
        outlineVariant: '#BEC9C7',
      },
      dark: {
        primary: '#55DBC9',
        onPrimary: '#003731',
        primaryBright: '#79E4D5',
        primaryDeep: '#3DBDAE',
        secondary: '#B0CCC7',
        onSecondary: '#1C3431',
        secondaryBright: '#BDD6D1',
        secondaryDeep: '#98B5B0',
        background: '#0F1514',
        surface: '#191F1E',
        onSurface: '#DDE4E3',
        onSurfaceVariant: '#BEC9C7',
        outlineVariant: '#3F4947',
      },
    },
  };
}

function indigo(): MaterialYouPalette {
  return {
    id: 'indigo',
    label: 'Indigo',
    swatch: ['#4355B9', '#BAC3FF'],
    schemes: {
      light: {
        primary: '#4355B9',
        onPrimary: '#FFFFFF',
        primaryBright: '#6674CE',
        primaryDeep: '#35449A',
        secondary: '#5C5D72',
        onSecondary: '#FFFFFF',
        secondaryBright: '#7B7C92',
        secondaryDeep: '#4A4B5E',
        background: '#F3F3FA',
        surface: '#FFFFFF',
        onSurface: '#1A1B21',
        onSurfaceVariant: '#45464F',
        outlineVariant: '#C6C5D0',
      },
      dark: {
        primary: '#BAC3FF',
        onPrimary: '#0F2A92',
        primaryBright: '#D0D6FF',
        primaryDeep: '#9BA7EF',
        secondary: '#C5C4DC',
        onSecondary: '#2D2F42',
        secondaryBright: '#D2D1E5',
        secondaryDeep: '#AFB0C4',
        background: '#121319',
        surface: '#1A1B22',
        onSurface: '#E4E1EC',
        onSurfaceVariant: '#C6C5D0',
        outlineVariant: '#45464F',
      },
    },
  };
}

function amber(): MaterialYouPalette {
  return {
    id: 'amber',
    label: 'Amber',
    swatch: ['#7A5900', '#F5BE48'],
    schemes: {
      light: {
        primary: '#7A5900',
        onPrimary: '#FFFFFF',
        primaryBright: '#97761F',
        primaryDeep: '#5F4600',
        secondary: '#6B5C3F',
        onSecondary: '#FFFFFF',
        secondaryBright: '#88765A',
        secondaryDeep: '#554732',
        background: '#F9F6EE',
        surface: '#FFFFFF',
        onSurface: '#1E1C13',
        onSurfaceVariant: '#4B4839',
        outlineVariant: '#D3CBB5',
      },
      dark: {
        primary: '#F5BE48',
        onPrimary: '#402D00',
        primaryBright: '#F8CD6B',
        primaryDeep: '#D9A434',
        secondary: '#DAC5A1',
        onSecondary: '#3C2F15',
        secondaryBright: '#E5D3B4',
        secondaryDeep: '#C0AC8A',
        background: '#171410',
        surface: '#1F1C15',
        onSurface: '#ECE2D3',
        onSurfaceVariant: '#D3CBB5',
        outlineVariant: '#4B4839',
      },
    },
  };
}

function graphite(): MaterialYouPalette {
  return {
    id: 'graphite',
    label: 'Graphite',
    swatch: ['#4B4B4F', '#C7C7C4'],
    schemes: {
      light: {
        primary: '#4B4B4F',
        onPrimary: '#FFFFFF',
        primaryBright: '#67676B',
        primaryDeep: '#3A3A3E',
        secondary: '#5C5C58',
        onSecondary: '#FFFFFF',
        secondaryBright: '#767672',
        secondaryDeep: '#464643',
        background: '#F4F4F3',
        surface: '#FFFFFF',
        onSurface: '#1A1A19',
        onSurfaceVariant: '#484846',
        outlineVariant: '#C9C9C5',
      },
      dark: {
        primary: '#C7C7C4',
        onPrimary: '#2F2F2D',
        primaryBright: '#D8D8D4',
        primaryDeep: '#ADADA9',
        secondary: '#C9C6BE',
        onSecondary: '#2A2924',
        secondaryBright: '#D7D5CE',
        secondaryDeep: '#B1AFA7',
        background: '#131313',
        surface: '#1B1B1A',
        onSurface: '#E4E3E1',
        onSurfaceVariant: '#C9C9C5',
        outlineVariant: '#484846',
      },
    },
  };
}

function amoled(): MaterialYouPalette {
  return {
    id: 'amoled',
    label: 'AMOLED',
    swatch: ['#1A1A1A', '#000000'],
    schemes: {
      light: {
        primary: '#1F1F1F',
        onPrimary: '#FFFFFF',
        primaryBright: '#3D3D3D',
        primaryDeep: '#0A0A0A',
        secondary: '#555555',
        onSecondary: '#FFFFFF',
        secondaryBright: '#6E6E6E',
        secondaryDeep: '#404040',
        background: '#FFFFFF',
        surface: '#FAFAFA',
        onSurface: '#1A1A1A',
        onSurfaceVariant: '#555555',
        outlineVariant: '#E0E0E0',
      },
      dark: {
        primary: '#CCCCCC',
        onPrimary: '#1A1A1A',
        primaryBright: '#E0E0E0',
        primaryDeep: '#B0B0B0',
        secondary: '#A8A8A8',
        onSecondary: '#1E1E1E',
        secondaryBright: '#BFBFBF',
        secondaryDeep: '#949494',
        background: '#000000',
        surface: '#121212',
        onSurface: '#EDEDED',
        onSurfaceVariant: '#B4B4B4',
        outlineVariant: '#2E2E2E',
      },
    },
  };
}

/** All built-in Material You color palettes, in picker order. */
export const MATERIAL_YOU_PALETTES: readonly MaterialYouPalette[] = [
  violet(),
  ocean(),
  indigo(),
  teal(),
  forest(),
  sunset(),
  amber(),
  rose(),
  crimson(),
  graphite(),
  amoled(),
];

/** Default palette applied when the user has not picked one yet. */
export const DEFAULT_COLOR_PALETTE_ID = 'violet';

/**
 * Builds a complete MUI `PaletteOptions` for one mode of one palette by
 * mapping M3 tonal roles onto MUI palette slots.
 */
export function buildMaterialYouPaletteOptions(mode: ThemeMode, paletteId: string): PaletteOptions {
  const palette =
    MATERIAL_YOU_PALETTES.find((candidate) => candidate.id === paletteId) ??
    MATERIAL_YOU_PALETTES.find((candidate) => candidate.id === DEFAULT_COLOR_PALETTE_ID)!;
  const scheme = palette.schemes[mode];
  const semantic = MATERIAL_YOU_SEMANTIC[mode];

  return {
    mode,
    primary: {
      main: scheme.primary,
      light: scheme.primaryBright,
      dark: scheme.primaryDeep,
      contrastText: scheme.onPrimary,
    },
    secondary: {
      main: scheme.secondary,
      light: scheme.secondaryBright,
      dark: scheme.secondaryDeep,
      contrastText: scheme.onSecondary,
    },
    error: { main: semantic.error },
    warning: { main: semantic.warning },
    info: { main: semantic.info },
    success: { main: semantic.success },
    background: {
      default: scheme.background,
      paper: scheme.surface,
    },
    text: {
      primary: scheme.onSurface,
      secondary: scheme.onSurfaceVariant,
    },
    divider: scheme.outlineVariant,
  };
}
