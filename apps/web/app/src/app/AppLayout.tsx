import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { ThemeSwitcher } from '../shared/components/ThemeSwitcher';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { APP_STRINGS } from './strings';

const DRAWER_WIDTH = 260;

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const enqueueSnackbar = useUiStore((s) => s.enqueueSnackbar);
  const navigate = useNavigate();

  const handleToggleDrawer = () => {
    setMobileOpen((prev) => !prev);
  };

  const handleCloseDrawer = () => {
    setMobileOpen(false);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      enqueueSnackbar({ message: APP_STRINGS.signedOutMessage, severity: 'info' });
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <BookmarksOutlinedIcon color="primary" />
          <Typography variant="h6" component="span" noWrap>
            {APP_STRINGS.brand}
          </Typography>
        </Stack>
      </Toolbar>
      <Divider />
      <Box sx={{ p: 2 }} aria-label={APP_STRINGS.navigationDrawerLabel}>
        <Typography variant="overline" color="text.secondary">
          {APP_STRINGS.drawerEmptyHeading}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {APP_STRINGS.drawerEmptyHint}
        </Typography>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { md: `${DRAWER_WIDTH}px` },
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            aria-label={
              mobileOpen ? APP_STRINGS.closeNavigationLabel : APP_STRINGS.openNavigationLabel
            }
            onClick={handleToggleDrawer}
            sx={{ mr: 2, display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="h6" component="span" noWrap sx={{ flexGrow: 1 }}>
            {APP_STRINGS.brand}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            {user ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ display: { xs: 'none', sm: 'inline' } }}
              >
                {user.email}
              </Typography>
            ) : null}
            <ThemeSwitcher label={APP_STRINGS.themeSwitcherLabel} />
            <Button
              color="inherit"
              size="small"
              startIcon={<LogoutOutlinedIcon />}
              onClick={() => void handleSignOut()}
              disabled={signingOut}
            >
              {APP_STRINGS.signOutLabel}
            </Button>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        aria-label={APP_STRINGS.navigationDrawerLabel}
        sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleCloseDrawer}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
          }}
        >
          {drawerContent}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
          }}
        >
          {drawerContent}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { md: `calc(100% - ${DRAWER_WIDTH}px)` },
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
