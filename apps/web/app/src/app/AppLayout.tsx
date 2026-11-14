import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import AllInboxOutlinedIcon from '@mui/icons-material/AllInboxOutlined';
import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';
import ImportExportOutlinedIcon from '@mui/icons-material/ImportExportOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import StarBorderOutlinedIcon from '@mui/icons-material/StarBorderOutlined';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type MouseEvent } from 'react';
import { Link as RouterLink, Outlet, useLocation, useNavigate } from 'react-router';
import { syncEngine } from '../api/sync-engine';
import { SyncStatusIndicator } from '../shared/components/SyncStatusIndicator';
import { ThemeSwitcher } from '../shared/components/ThemeSwitcher';
import { useAuthStore } from '../stores/authStore';
import { selectSortedCollections, useLibraryStore } from '../stores/libraryStore';
import { useSyncStore } from '../stores/syncStore';
import { useUiStore } from '../stores/uiStore';
import { APP_STRINGS } from './strings';

const DRAWER_WIDTH = 264;

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);

  const user = useAuthStore((s) => s.user);
  const authStatus = useAuthStore((s) => s.status);
  const logout = useAuthStore((s) => s.logout);
  const stats = useLibraryStore((s) => s.stats);
  const collectionsById = useLibraryStore((s) => s.collectionsById);
  const isBootstrapping = useSyncStore((s) => s.isBootstrapping);
  const enqueueSnackbar = useUiStore((s) => s.enqueueSnackbar);

  const location = useLocation();
  const navigate = useNavigate();

  const collections = selectSortedCollections({ collectionsById } as Parameters<
    typeof selectSortedCollections
  >[0]);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    void syncEngine.start();
    return () => {
      syncEngine.stop();
    };
  }, [authStatus]);

  const handleToggleMobileDrawer = () => {
    setMobileOpen((prev) => !prev);
  };

  const handleCloseMobileDrawer = () => {
    setMobileOpen(false);
  };

  const handleToggleDesktopSidebar = () => {
    setDesktopOpen((prev) => !prev);
  };

  const handleOpenAccountMenu = (event: MouseEvent<HTMLElement>) => {
    setAccountAnchor(event.currentTarget);
  };

  const handleCloseAccountMenu = () => {
    setAccountAnchor(null);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    handleCloseAccountMenu();
    setSigningOut(true);
    try {
      await logout();
      enqueueSnackbar({ message: APP_STRINGS.signedOutMessage, severity: 'info' });
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const searchParams = new URLSearchParams(location.search);
  const currentScope = searchParams.get('view');
  const isLibraryAll = location.pathname === '/' && !currentScope;
  const isLibraryFavorites = location.pathname === '/' && currentScope === 'favorites';
  const isLibraryUnassigned = location.pathname === '/' && currentScope === 'unassigned';

  const effectiveDesktopWidth = desktopOpen ? DRAWER_WIDTH : 0;

  const drawerContent = (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <BookmarksOutlinedIcon color="primary" />
          <Typography variant="h6" component="span" noWrap>
            {APP_STRINGS.brand}
          </Typography>
        </Stack>
      </Toolbar>
      <Divider />

      <List dense aria-label={APP_STRINGS.navigationDrawerLabel}>
        <ListItem disablePadding>
          <ListItemButton
            component={RouterLink}
            to="/"
            selected={isLibraryAll}
            onClick={handleCloseMobileDrawer}
          >
            <ListItemIcon>
              <BookmarksOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={APP_STRINGS.navAllBookmarks} />
            <Chip size="small" label={stats.total} variant="outlined" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding>
          <ListItemButton
            component={RouterLink}
            to="/?view=favorites"
            selected={isLibraryFavorites}
            onClick={handleCloseMobileDrawer}
          >
            <ListItemIcon>
              <StarBorderOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={APP_STRINGS.navFavorites} />
            <Chip size="small" label={stats.favorites} variant="outlined" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding>
          <ListItemButton
            component={RouterLink}
            to="/?view=unassigned"
            selected={isLibraryUnassigned}
            onClick={handleCloseMobileDrawer}
          >
            <ListItemIcon>
              <AllInboxOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={APP_STRINGS.navUnassigned} />
            <Chip size="small" label={stats.unassigned} variant="outlined" />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding>
          <ListItemButton
            component={RouterLink}
            to="/trash"
            selected={location.pathname === '/trash'}
            onClick={handleCloseMobileDrawer}
          >
            <ListItemIcon>
              <DeleteOutlineOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={APP_STRINGS.navTrash} />
            <Chip size="small" label={stats.trashed} variant="outlined" />
          </ListItemButton>
        </ListItem>
      </List>

      <Divider />

      <Box sx={{ px: 2, py: 1.5, flexGrow: 1, overflowY: 'auto' }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
        >
          <Typography variant="overline" color="text.secondary">
            {APP_STRINGS.drawerCollectionsHeading}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {`${collections.length} ${APP_STRINGS.drawerCollectionsCountSuffix}`}
          </Typography>
        </Stack>

        {isBootstrapping && collections.length === 0 ? (
          <Stack spacing={1}>
            <Skeleton variant="rounded" height={28} />
            <Skeleton variant="rounded" height={28} />
            <Skeleton variant="rounded" height={28} />
          </Stack>
        ) : (
          <Stack spacing={1}>
            {collections.slice(0, 5).map((col) => (
              <Stack
                key={col.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between', py: 0.25 }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <FolderOutlinedIcon fontSize="small" color="action" />
                  <Typography variant="body2" noWrap>
                    {col.title}
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {col.bookmarkCount}
                </Typography>
              </Stack>
            ))}
            <Typography variant="caption" color="text.secondary">
              {APP_STRINGS.drawerCollectionsHint}
            </Typography>
          </Stack>
        )}
      </Box>

      <Divider />

      <List dense>
        <ListItem disablePadding>
          <ListItemButton
            component={RouterLink}
            to="/health"
            selected={location.pathname === '/health'}
            onClick={handleCloseMobileDrawer}
          >
            <ListItemIcon>
              <HealthAndSafetyOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={APP_STRINGS.navHealth} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding>
          <ListItemButton
            component={RouterLink}
            to="/portability"
            selected={location.pathname === '/portability'}
            onClick={handleCloseMobileDrawer}
          >
            <ListItemIcon>
              <ImportExportOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={APP_STRINGS.navPortability} />
          </ListItemButton>
        </ListItem>

        <ListItem disablePadding>
          <ListItemButton
            component={RouterLink}
            to="/settings"
            selected={location.pathname === '/settings'}
            onClick={handleCloseMobileDrawer}
          >
            <ListItemIcon>
              <SettingsOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={APP_STRINGS.navSettings} />
          </ListItemButton>
        </ListItem>

        {user?.role === 'admin' ? (
          <ListItem disablePadding>
            <ListItemButton
              component={RouterLink}
              to="/admin"
              selected={location.pathname === '/admin'}
              onClick={handleCloseMobileDrawer}
            >
              <ListItemIcon>
                <AdminPanelSettingsOutlinedIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={APP_STRINGS.navAdmin} />
            </ListItemButton>
          </ListItem>
        ) : null}
      </List>
    </Box>
  );

  const accountMenuOpen = Boolean(accountAnchor);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${effectiveDesktopWidth}px)` },
          ml: { md: `${effectiveDesktopWidth}px` },
        }}
      >
        <Toolbar sx={{ gap: 1.5 }}>
          <IconButton
            color="inherit"
            edge="start"
            aria-label={
              mobileOpen ? APP_STRINGS.closeNavigationLabel : APP_STRINGS.openNavigationLabel
            }
            onClick={handleToggleMobileDrawer}
            sx={{ display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          <Tooltip title={APP_STRINGS.toggleDesktopSidebarLabel}>
            <IconButton
              color="inherit"
              edge="start"
              aria-label={APP_STRINGS.toggleDesktopSidebarLabel}
              aria-expanded={desktopOpen}
              onClick={handleToggleDesktopSidebar}
              sx={{ display: { xs: 'none', md: 'inline-flex' } }}
            >
              {desktopOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
            </IconButton>
          </Tooltip>

          {!desktopOpen ? (
            <Typography
              variant="h6"
              component="span"
              noWrap
              sx={{ display: { xs: 'none', md: 'inline' } }}
            >
              {APP_STRINGS.brand}
            </Typography>
          ) : null}

          <Box sx={{ flexGrow: 1, maxWidth: 440 }}>
            <TextField
              size="small"
              fullWidth
              disabled
              placeholder={APP_STRINGS.searchPlaceholder}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchOutlinedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                },
                htmlInput: {
                  'aria-label': APP_STRINGS.searchAriaLabel,
                },
              }}
            />
          </Box>

          <Box sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }} />

          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <SyncStatusIndicator />
            <ThemeSwitcher label={APP_STRINGS.themeSwitcherLabel} />

            {user ? (
              <>
                <Button
                  color="inherit"
                  size="small"
                  startIcon={<AccountCircleOutlinedIcon />}
                  onClick={handleOpenAccountMenu}
                  aria-controls={accountMenuOpen ? 'account-menu' : undefined}
                  aria-haspopup="true"
                  aria-expanded={accountMenuOpen ? 'true' : undefined}
                  sx={{ textTransform: 'none', display: { xs: 'none', sm: 'inline-flex' } }}
                >
                  {user.email}
                </Button>
                <IconButton
                  color="inherit"
                  onClick={handleOpenAccountMenu}
                  aria-label={APP_STRINGS.accountMenuLabel}
                  sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
                >
                  <AccountCircleOutlinedIcon />
                </IconButton>
                <Menu
                  id="account-menu"
                  anchorEl={accountAnchor}
                  open={accountMenuOpen}
                  onClose={handleCloseAccountMenu}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                >
                  <MenuItem disabled>
                    <Typography variant="body2">{user.email}</Typography>
                  </MenuItem>
                  <Divider />
                  <MenuItem
                    onClick={() => {
                      handleCloseAccountMenu();
                      navigate('/settings');
                    }}
                  >
                    <ListItemIcon>
                      <SettingsOutlinedIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={APP_STRINGS.accountSettingsItem} />
                  </MenuItem>
                  <MenuItem onClick={() => void handleSignOut()} disabled={signingOut}>
                    <ListItemIcon>
                      <LogoutOutlinedIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText primary={APP_STRINGS.signOutLabel} />
                  </MenuItem>
                </Menu>
              </>
            ) : null}

            <Tooltip title={APP_STRINGS.signOutLabel}>
              <IconButton
                color="inherit"
                size="small"
                aria-label={APP_STRINGS.signOutLabel}
                onClick={() => void handleSignOut()}
                disabled={signingOut}
              >
                <LogoutOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Toolbar>
      </AppBar>

      <Box
        component="nav"
        aria-label={APP_STRINGS.navigationDrawerLabel}
        sx={{ width: { md: effectiveDesktopWidth }, flexShrink: { md: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleCloseMobileDrawer}
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
          open={desktopOpen}
          sx={{
            display: { xs: 'none', md: desktopOpen ? 'block' : 'none' },
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
          width: { md: `calc(100% - ${effectiveDesktopWidth}px)` },
        }}
      >
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
