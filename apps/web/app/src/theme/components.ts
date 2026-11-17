import type { Components, Theme } from '@mui/material/styles';

/**
 * Extra `tonal` Button variant (M3 "filled tonal button"): a low-opacity
 * primary container background with on-container text.
 */
declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides {
    tonal: true;
  }
}

interface PrimaryPaletteSource {
  palette: { primary: { main: string } };
}

function primaryTint(vars: PrimaryPaletteSource, percentage: number): string {
  return `color-mix(in srgb, ${vars.palette.primary.main} ${percentage}%, transparent)`;
}

export const components: Components<Theme> = {
  MuiCssBaseline: {
    styleOverrides: {
      body: {
        margin: 0,
        minHeight: '100vh',
        backgroundColor: 'var(--mui-palette-background-default)',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
      },
      '::selection': {
        backgroundColor: 'color-mix(in srgb, var(--mui-palette-primary-main) 24%, transparent)',
      },
    },
  },
  MuiAppBar: {
    defaultProps: {
      elevation: 0,
      color: 'default',
    },
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundColor: (theme.vars ?? theme).palette.background.paper,
        borderBottom: `1px solid ${(theme.vars ?? theme).palette.divider}`,
      }),
    },
  },
  MuiDrawer: {
    styleOverrides: {
      paper: ({ theme }) => ({
        backgroundColor: (theme.vars ?? theme).palette.background.paper,
        borderColor: (theme.vars ?? theme).palette.divider,
      }),
    },
  },
  MuiPaper: {
    defaultProps: {
      elevation: 0,
    },
    styleOverrides: {
      outlined: ({ theme }) => ({
        borderColor: (theme.vars ?? theme).palette.divider,
      }),
    },
  },
  MuiCard: {
    styleOverrides: {
      root: {
        borderRadius: 20,
        overflow: 'hidden',
      },
    },
  },
  MuiButton: {
    defaultProps: {
      disableElevation: true,
    },
    styleOverrides: {
      root: {
        borderRadius: 999,
        paddingLeft: 20,
        paddingRight: 20,
      },
      sizeSmall: {
        paddingLeft: 16,
        paddingRight: 16,
      },
      sizeLarge: {
        paddingLeft: 26,
        paddingRight: 26,
      },
    },
    variants: [
      {
        props: { variant: 'tonal' },
        style: ({ theme }) => {
          const vars = theme.vars ?? theme;
          return {
            backgroundColor: primaryTint(vars, 14),
            color: vars.palette.primary.main,
            '&:hover': {
              backgroundColor: primaryTint(vars, 22),
            },
            '&:active': {
              backgroundColor: primaryTint(vars, 28),
            },
          };
        },
      },
    ],
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        borderRadius: 999,
      },
    },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        fontWeight: 500,
        borderRadius: 8,
      },
      sizeSmall: {
        borderRadius: 8,
      },
      outlined: ({ theme }) => ({
        borderColor: (theme.vars ?? theme).palette.divider,
      }),
    },
  },
  MuiTabs: {
    styleOverrides: {
      indicator: {
        height: 3,
        borderTopLeftRadius: 3,
        borderTopRightRadius: 3,
      },
    },
  },
  MuiTab: {
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontWeight: 600,
      },
    },
  },
  MuiToggleButtonGroup: {
    styleOverrides: {
      root: ({ theme }) => ({
        backgroundColor: (theme.vars ?? theme).palette.background.paper,
        border: `1px solid ${(theme.vars ?? theme).palette.divider}`,
        borderRadius: 999,
        padding: 3,
        gap: 2,
        '& .MuiToggleButtonGroup-grouped': {
          borderRadius: 999,
          border: 'none',
          margin: 0,
        },
      }),
    },
  },
  MuiToggleButton: {
    styleOverrides: {
      root: ({ theme }) => {
        const vars = theme.vars ?? theme;
        return {
          textTransform: 'none',
          fontWeight: 600,
          padding: '5px 14px',
          color: vars.palette.text.secondary,
          '&:hover': {
            backgroundColor: primaryTint(vars, 8),
          },
          '&.Mui-selected': {
            backgroundColor: primaryTint(vars, 15),
            color: vars.palette.primary.main,
            '&:hover': {
              backgroundColor: primaryTint(vars, 22),
            },
          },
        };
      },
    },
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: 14,
      },
    },
  },
  MuiFilledInput: {
    styleOverrides: {
      root: {
        borderRadius: '14px 14px 4px 4px',
      },
    },
  },
  MuiAlert: {
    styleOverrides: {
      root: {
        borderRadius: 16,
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        borderRadius: 28,
      },
    },
  },
  MuiMenu: {
    styleOverrides: {
      paper: {
        borderRadius: 16,
      },
    },
  },
  MuiMenuItem: {
    styleOverrides: {
      root: {
        borderRadius: 12,
      },
    },
  },
  MuiListItemButton: {
    styleOverrides: {
      root: {
        borderRadius: 999,
      },
    },
  },
  MuiTooltip: {
    styleOverrides: {
      tooltip: {
        borderRadius: 8,
        fontSize: '0.75rem',
        fontWeight: 500,
        padding: '6px 10px',
      },
    },
  },
  MuiSnackbarContent: {
    styleOverrides: {
      root: {
        borderRadius: 16,
      },
    },
  },
  MuiSkeleton: {
    styleOverrides: {
      root: {
        borderRadius: 12,
      },
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: {
        borderRadius: 999,
        overflow: 'hidden',
      },
    },
  },
  MuiFab: {
    styleOverrides: {
      root: {
        borderRadius: 16,
      },
    },
  },
};
