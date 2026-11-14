import CheckIcon from '@mui/icons-material/Check';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import { useState, type MouseEvent } from 'react';
import { useThemeController } from '../../theme/ThemeController';

export interface ThemeSwitcherProps {
  label?: string;
}

export function ThemeSwitcher({ label = 'Switch theme' }: ThemeSwitcherProps) {
  const { themeId, setTheme, themes } = useThemeController();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSelect = (nextId: string) => {
    setTheme(nextId);
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
        {themes.map((option) => {
          const selected = option.id === themeId;
          return (
            <MenuItem key={option.id} selected={selected} onClick={() => handleSelect(option.id)}>
              <ListItemIcon>
                {selected ? (
                  <CheckIcon fontSize="small" />
                ) : (
                  <PaletteOutlinedIcon fontSize="small" />
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
