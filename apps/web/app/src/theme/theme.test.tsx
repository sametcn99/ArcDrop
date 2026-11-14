import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useTheme, type PaletteOptions } from '@mui/material/styles';
import Typography from '@mui/material/Typography';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeSwitcher } from '../shared/components/ThemeSwitcher';
import { createAppTheme, registerTheme } from './theme';
import { THEME_STORAGE_KEY, ThemeController, useThemeController } from './ThemeController';

function mockMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      }
    },
    removeEventListener: (_event: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      }
    },
    dispatchEvent: vi.fn(),
  }));
}

function ThemeProbe() {
  const { themeId, setTheme, themes } = useThemeController();
  const muiTheme = useTheme();

  return (
    <Box>
      <Typography data-testid="active-theme">{themeId}</Typography>
      <Typography data-testid="palette-mode">{muiTheme.palette.mode}</Typography>
      <Typography data-testid="primary-color">{muiTheme.palette.primary.main}</Typography>
      <Typography data-testid="css-var-primary">{muiTheme.vars.palette.primary.main}</Typography>
      <Typography data-testid="theme-ids">{themes.map((t) => t.id).join(',')}</Typography>
      <Button onClick={() => setTheme('dark')}>Set dark</Button>
      <Button onClick={() => setTheme('light')}>Set light</Button>
    </Box>
  );
}

describe('Theme system', () => {
  it('defaults to prefers-color-scheme when localStorage has no saved preference', () => {
    mockMatchMedia(true);

    render(
      <ThemeController>
        <ThemeProbe />
      </ThemeController>,
    );

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('palette-mode')).toHaveTextContent('dark');
    expect(screen.getByTestId('css-var-primary')).toHaveTextContent(
      'var(--mui-palette-primary-main)',
    );
  });

  it('persists theme choice in localStorage and restores it across reloads', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();

    const firstRender = render(
      <ThemeController>
        <ThemeProbe />
      </ThemeController>,
    );

    expect(screen.getByTestId('active-theme')).toHaveTextContent('light');

    await user.click(screen.getByRole('button', { name: 'Set dark' }));

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    firstRender.unmount();

    // Simulate reload with system still preferring light; saved dark choice wins.
    render(
      <ThemeController>
        <ThemeProbe />
      </ThemeController>,
    );

    expect(screen.getByTestId('active-theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('palette-mode')).toHaveTextContent('dark');
  });

  it('does not re-render unrelated subtree children when switching themes', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    const onRender = vi.fn();

    function StaticSubtree() {
      return <Typography data-testid="static-child">Static content</Typography>;
    }

    function ControlsOnly() {
      const { setTheme } = useThemeController();
      return <Button onClick={() => setTheme('dark')}>Toggle</Button>;
    }

    render(
      <ThemeController>
        <ControlsOnly />
        <Profiler id="static-subtree" onRender={onRender}>
          <StaticSubtree />
        </Profiler>
      </ThemeController>,
    );

    expect(onRender).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Toggle' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('supports dynamically registering a third theme without modifying ThemeController or ThemeSwitcher', async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();

    const oceanPalette: PaletteOptions = {
      mode: 'dark',
      primary: {
        main: '#0EA5E9',
      },
      background: {
        default: '#082F49',
        paper: '#0C4A6E',
      },
    };

    const unregister = registerTheme('ocean', {
      label: 'Ocean',
      create: () => createAppTheme(oceanPalette),
    });

    const rendered = render(
      <ThemeController>
        <ThemeProbe />
        <ThemeSwitcher />
      </ThemeController>,
    );

    try {
      expect(screen.getByTestId('theme-ids')).toHaveTextContent('light,dark,ocean');

      await user.click(screen.getByRole('button', { name: 'Switch theme' }));
      const oceanMenuItem = await screen.findByRole('menuitem', { name: 'Ocean' });
      await user.click(oceanMenuItem);

      expect(screen.getByTestId('active-theme')).toHaveTextContent('ocean');
      expect(screen.getByTestId('primary-color')).toHaveTextContent('#0EA5E9');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('ocean');
      expect(document.documentElement.dataset.theme).toBe('ocean');
    } finally {
      rendered.unmount();
      unregister();
    }
  });
});
