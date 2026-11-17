import Box from '@mui/material/Box';
import CheckIcon from '@mui/icons-material/Check';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import Divider from '@mui/material/Divider';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import Tooltip from '@mui/material/Tooltip';
import { useState, type MouseEvent } from 'react';
import { SHARED_THEME_STRINGS } from '../strings';
import { useThemeController } from '../../theme/ThemeController';

export interface ThemeSwitcherProps {
  label?: string;
}

export function ThemeSwitcher({ label = 'Switch theme' }: ThemeSwitcherProps) {
  const { themeId, setTheme, themes, paletteId, setPalette, palettes } = useThemeController();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelectTheme = (nextId: string) => {
    setTheme(nextId);
    handleClose();
  };

  const handleSelectPalette = (nextId: string) => {
    setPalette(nextId);
    handleClose();
  };

  const renderCurrentIcon = () => {
    if (themeId === 'dark') {
      return <DarkModeOutlinedIcon />;
    }
    if (themeId === 'light') {
      return <LightModeOutlinedIcon />;
    }
    return <PaletteOutlinedIcon />;
  };

  const renderThemeIcon = (optionId: string, selected: boolean) => {
    if (selected) {
      return <CheckIcon fontSize="small" />;
    }
    if (optionId === 'dark') {
      return <DarkModeOutlinedIcon fontSize="small" />;
    }
    if (optionId === 'light') {
      return <LightModeOutlinedIcon fontSize="small" />;
    }
    return <PaletteOutlinedIcon fontSize="small" />;
  };

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          color="inherit"
          aria-label={label}
          aria-controls={open ? 'theme-switcher-menu' : undefined}
          aria-haspopup="true"
          aria-expanded={open ? 'true' : undefined}
          onClick={handleOpen}
        >
          {renderCurrentIcon()}
        </IconButton>
      </Tooltip>
      <Menu
        id="theme-switcher-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <ListSubheader disableSticky>{SHARED_THEME_STRINGS.appearanceSectionLabel}</ListSubheader>
        {themes.map((option) => {
          const selected = option.id === themeId;
          return (
            <MenuItem
              key={option.id}
              selected={selected}
              onClick={() => handleSelectTheme(option.id)}
            >
              <ListItemIcon>{renderThemeIcon(option.id, selected)}</ListItemIcon>
              <ListItemText primary={option.label} />
            </MenuItem>
          );
        })}
        <Divider sx={{ my: 1 }} />
        <ListSubheader disableSticky>{SHARED_THEME_STRINGS.paletteSectionLabel}</ListSubheader>
        {palettes.map((option) => {
          const selected = option.id === paletteId;
          return (
            <MenuItem
              key={option.id}
              selected={selected}
              onClick={() => handleSelectPalette(option.id)}
            >
              <ListItemIcon>
                {selected ? (
                  <CheckIcon fontSize="small" />
                ) : (
                  <Box
                    aria-hidden
                    sx={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: `linear-gradient(135deg, ${option.swatch[0]} 0 55%, ${option.swatch[1]} 55% 100%)`,
                      boxShadow: (theme) => `inset 0 0 0 1px ${theme.palette.divider}`,
                    }}
                  />
                )}
              </ListItemIcon>
              <ListItemText primary={option.label} />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
