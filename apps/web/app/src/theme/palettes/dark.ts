import type { PaletteOptions } from '@mui/material/styles';

export const darkPalette: PaletteOptions = {
  mode: 'dark',
  primary: {
    main: '#60A5FA',
    light: '#93C5FD',
    dark: '#3B82F6',
    contrastText: '#0B1120',
  },
  secondary: {
    main: '#2DD4BF',
    light: '#5EEAD4',
    dark: '#14B8A6',
    contrastText: '#042F2E',
  },
  error: {
    main: '#F87171',
    light: '#FCA5A5',
    dark: '#EF4444',
  },
  warning: {
    main: '#FBBF24',
    light: '#FCD34D',
    dark: '#F59E0B',
  },
  info: {
    main: '#38BDF8',
    light: '#7DD3FC',
    dark: '#0284C7',
  },
  success: {
    main: '#4ADE80',
    light: '#86EFAC',
    dark: '#22C55E',
  },
  background: {
    default: '#0B1120',
    paper: '#111827',
  },
  text: {
    primary: '#F1F5F9',
    secondary: '#94A3B8',
  },
  divider: '#1E293B',
};
