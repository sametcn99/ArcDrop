import AccountCircleOutlinedIcon from '@mui/icons-material/AccountCircleOutlined';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import AllInboxOutlinedIcon from '@mui/icons-material/AllInboxOutlined';
import BookmarksOutlinedIcon from '@mui/icons-material/BookmarksOutlined';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';
import ImportExportOutlinedIcon from '@mui/icons-material/ImportExportOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import LogoutOutlinedIcon from '@mui/icons-material/LogoutOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import StarBorderOutlinedIcon from '@mui/icons-material/StarBorderOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link as RouterLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { syncEngine } from '../api/sync-engine';
import {
  addBookmarkToCollectionAction,
  moveCollectionParentAction,
  reorderCollectionBookmarksAction,
  reorderSiblingCollectionsAction,
} from '../shared/actions/collectionActions';
import { fetchNotificationsAction } from '../shared/actions/notificationActions';
import { CollectionTreeSidebar } from '../shared/components/CollectionTreeSidebar';
import { NotificationsDrawer } from '../shared/components/NotificationsDrawer';
import { QuickAddDialog, type QuickAddInitialValues } from '../shared/components/QuickAddDialog';
import { SearchBar } from '../shared/components/SearchBar';
import { SyncStatusIndicator } from '../shared/components/SyncStatusIndicator';
import { TagManagerDialog } from '../shared/components/TagManagerDialog';
import { ThemeSwitcher } from '../shared/components/ThemeSwitcher';
import { UploadFileDialog } from '../shared/components/UploadFileDialog';
import { AppDndContext, type DragItemData, type DropTargetData } from '../shared/hooks/useAppDnd';
import { getSiblingCollections } from '../shared/utils/collectionTree';
import { useAuthStore } from '../stores/authStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useNotificationsStore } from '../stores/notificationsStore';
import { useUiStore } from '../stores/uiStore';
import { APP_STRINGS } from './strings';

const DRAWER_WIDTH = 264;

const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }
  return closestCenter(args);
};

function parseQuickAddSearchParams(
  search: string,
  fallbackCollectionId?: string,
): QuickAddInitialValues {
  const params = new URLSearchParams(search);
  const url = params.get('url') ?? undefined;
  const title = params.get('title') ?? undefined;
  const collection = params.get('collection') ?? fallbackCollectionId ?? undefined;
  const rawTags = params.getAll('tags');
  const tags: string[] = [];
  for (const entry of rawTags) {
    for (const part of entry.split(',')) {
      const trimmed = part.trim();
      if (trimmed && !tags.includes(trimmed)) {
        tags.push(trimmed);
      }
    }
  }
  const favoriteRaw = params.get('favorite');
  const favorite = favoriteRaw === 'true' || favoriteRaw === '1';
  return {
    url,
    title,
    collection,
    tags: tags.length > 0 ? tags : undefined,
    favorite,
  };
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const [accountAnchor, setAccountAnchor] = useState<HTMLElement | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [quickAddDialogOpen, setQuickAddDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<DragItemData | null>(null);
  const [manualSortContext, setManualSortContext] = useState<{
    collectionId: string;
    viewKey: string;
    orderedIds: string[];
  } | null>(null);

  const updateManualSortContext = useCallback(
    (
      next: {
        collectionId: string;
        viewKey: string;
        orderedIds: string[];
      } | null,
    ) => {
      setManualSortContext((prev) => {
        if (prev === null && next === null) return prev;
        if (
          prev !== null &&
          next !== null &&
          prev.collectionId === next.collectionId &&
          prev.viewKey === next.viewKey &&
          prev.orderedIds === next.orderedIds
        ) {
          return prev;
        }
        return next;
      });
    },
    [],
  );

  const user = useAuthStore((s) => s.user);
  const authStatus = useAuthStore((s) => s.status);
  const logout = useAuthStore((s) => s.logout);
  const stats = useLibraryStore((s) => s.stats);
  const tagCount = useLibraryStore((s) => Object.keys(s.tagsById).length);
  const unreadNotifications = useNotificationsStore((s) => s.unreadCount);
  const setNotificationsDrawerOpen = useNotificationsStore((s) => s.setDrawerOpen);
  const enqueueSnackbar = useUiStore((s) => s.enqueueSnackbar);

  const location = useLocation();
  const navigate = useNavigate();
  const { collectionId: routeCollectionId } = useParams<{ collectionId: string }>();

  const isQuickAddRoute = location.pathname === '/quick-add';
  const effectiveQuickAddOpen = quickAddDialogOpen || isQuickAddRoute;
  const quickAddInitialValues = useMemo(
    () =>
      isQuickAddRoute
        ? parseQuickAddSearchParams(location.search, routeCollectionId)
        : routeCollectionId
          ? { collection: routeCollectionId }
          : undefined,
    [isQuickAddRoute, location.search, routeCollectionId],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      return;
    }
    void syncEngine.start();
    void fetchNotificationsAction().catch(() => undefined);
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

  const handleCloseQuickAdd = () => {
    setQuickAddDialogOpen(false);
    if (isQuickAddRoute) {
      navigate('/', { replace: true });
    }
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

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragItemData | undefined;
    setActiveDrag(data ?? null);
  };

  const handleDragCancel = () => {
    setActiveDrag(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as DragItemData | undefined;
    if (!activeData) return;

    const overData = over.data.current as (DropTargetData | DragItemData) | undefined;
    if (!overData) return;

    if (activeData.kind === 'bookmark') {
      if (overData.kind === 'collection-drop') {
        void addBookmarkToCollectionAction(activeData.bookmark, overData.collectionId).catch(
          () => undefined,
        );
        return;
      }

      if (
        manualSortContext &&
        overData.kind === 'bookmark' &&
        activeData.bookmarkId !== overData.bookmarkId
      ) {
        const oldIndex = manualSortContext.orderedIds.indexOf(activeData.bookmarkId);
        const newIndex = manualSortContext.orderedIds.indexOf(overData.bookmarkId);
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const nextOrder = arrayMove(manualSortContext.orderedIds, oldIndex, newIndex);
          void reorderCollectionBookmarksAction(
            manualSortContext.collectionId,
            manualSortContext.viewKey,
            nextOrder,
          ).catch(() => undefined);
        }
      }
      return;
    }

    if (activeData.kind === 'collection') {
      if (overData.kind === 'collection-drop') {
        if (overData.collectionId !== activeData.collectionId) {
          void moveCollectionParentAction(activeData.collectionId, overData.collectionId).catch(
            () => undefined,
          );
        }
        return;
      }

      if (overData.kind === 'collection-root-drop') {
        if (activeData.parentId !== null) {
          void moveCollectionParentAction(activeData.collectionId, null).catch(() => undefined);
        }
        return;
      }

      if (overData.kind === 'collection-reorder') {
        if (overData.targetId === activeData.collectionId) return;
        const currentCollectionsById = useLibraryStore.getState().collectionsById;

        if (activeData.parentId === overData.parentId) {
          const siblings = getSiblingCollections(currentCollectionsById, overData.parentId);
          const fromIdx = siblings.findIndex((item) => item.id === activeData.collectionId);
          const targetIdx = siblings.findIndex((item) => item.id === overData.targetId);
          if (fromIdx === -1 || targetIdx === -1) return;

          const reordered = [...siblings];
          const [moved] = reordered.splice(fromIdx, 1);
          if (!moved) return;
          const adjustedTargetIdx = reordered.findIndex((item) => item.id === overData.targetId);
          const insertIdx =
            overData.position === 'after' ? adjustedTargetIdx + 1 : adjustedTargetIdx;
          reordered.splice(insertIdx, 0, moved);

          const payload = reordered.map((item, idx) => ({ id: item.id, order: idx }));
          void reorderSiblingCollectionsAction(payload).catch(() => undefined);
        } else {
          void (async () => {
            await moveCollectionParentAction(activeData.collectionId, overData.parentId);
            const updatedById = useLibraryStore.getState().collectionsById;
            const siblings = getSiblingCollections(updatedById, overData.parentId);
            const fromIdx = siblings.findIndex((item) => item.id === activeData.collectionId);
            if (fromIdx === -1) return;
            const reordered = [...siblings];
            const [moved] = reordered.splice(fromIdx, 1);
            if (!moved) return;
            const targetIdx = reordered.findIndex((item) => item.id === overData.targetId);
            const insertIdx =
              targetIdx === -1
                ? reordered.length
                : overData.position === 'after'
                  ? targetIdx + 1
                  : targetIdx;
            reordered.splice(insertIdx, 0, moved);
            await reorderSiblingCollectionsAction(
              reordered.map((item, idx) => ({ id: item.id, order: idx })),
            );
          })().catch(() => undefined);
        }
      }
    }
  };

  const dndContextValue = useMemo(
    () => ({
      hasProvider: true,
      activeDrag,
      manualSortContext,
      setManualSortContext: updateManualSortContext,
    }),
    [activeDrag, manualSortContext, updateManualSortContext],
  );

  const searchParams = new URLSearchParams(location.search);
  const currentScope = searchParams.get('view');
  const isLibraryAll = location.pathname === '/' && !currentScope;
  const isLibraryFavorites = location.pathname === '/' && currentScope === 'favorites';
  const isLibraryUnassigned = location.pathname === '/' && currentScope === 'unassigned';

  const effectiveDesktopWidth = desktopOpen ? DRAWER_WIDTH : 0;

  const renderDrawerContent = (enableDnd: boolean) => (
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
        <CollectionTreeSidebar enableDnd={enableDnd} onNavigate={handleCloseMobileDrawer} />
      </Box>

      <Divider />

      <List dense>
        <ListItem disablePadding>
          <ListItemButton
            onClick={() => {
              setTagManagerOpen(true);
              handleCloseMobileDrawer();
            }}
          >
            <ListItemIcon>
              <LocalOfferOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary={APP_STRINGS.navManageTags} />
            <Chip size="small" label={tagCount} variant="outlined" />
          </ListItemButton>
        </ListItem>

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

  const dragOverlayLabel =
    activeDrag?.kind === 'collection'
      ? activeDrag.title
      : activeDrag?.kind === 'bookmark'
        ? (activeDrag.bookmark.title ??
          activeDrag.bookmark.fileName ??
          activeDrag.bookmark.url ??
          activeDrag.bookmarkId)
        : null;

  return (
    <AppDndContext.Provider value={dndContextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
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

              <SearchBar />

              <Box sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }} />

              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  startIcon={<AddOutlinedIcon />}
                  onClick={() => setQuickAddDialogOpen(true)}
                  sx={{ display: { xs: 'none', sm: 'inline-flex' }, whiteSpace: 'nowrap' }}
                >
                  {APP_STRINGS.quickAddLabel}
                </Button>
                <Tooltip title={APP_STRINGS.quickAddLabel}>
                  <IconButton
                    color="inherit"
                    size="small"
                    aria-label={APP_STRINGS.quickAddLabel}
                    onClick={() => setQuickAddDialogOpen(true)}
                    sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
                  >
                    <AddOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  startIcon={<UploadFileOutlinedIcon />}
                  onClick={() => setUploadDialogOpen(true)}
                  sx={{ display: { xs: 'none', sm: 'inline-flex' }, whiteSpace: 'nowrap' }}
                >
                  {APP_STRINGS.uploadFileLabel}
                </Button>
                <Tooltip title={APP_STRINGS.uploadFileLabel}>
                  <IconButton
                    color="inherit"
                    size="small"
                    aria-label={APP_STRINGS.uploadFileLabel}
                    onClick={() => setUploadDialogOpen(true)}
                    sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
                  >
                    <UploadFileOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <Tooltip title={APP_STRINGS.notificationsButtonLabel}>
                  <IconButton
                    color="inherit"
                    size="small"
                    aria-label={APP_STRINGS.notificationsButtonLabel}
                    onClick={() => setNotificationsDrawerOpen(true)}
                  >
                    <Badge
                      badgeContent={unreadNotifications}
                      color="error"
                      data-testid="notifications-unread-badge"
                    >
                      <NotificationsOutlinedIcon fontSize="small" />
                    </Badge>
                  </IconButton>
                </Tooltip>

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
              sx={{
                display: { xs: 'block', md: 'none' },
                '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
              }}
            >
              {mobileOpen ? renderDrawerContent(false) : null}
            </Drawer>
            <Drawer
              variant="permanent"
              open={desktopOpen}
              sx={{
                display: { xs: 'none', md: desktopOpen ? 'block' : 'none' },
                '& .MuiDrawer-paper': { boxSizing: 'border-box', width: DRAWER_WIDTH },
              }}
            >
              {renderDrawerContent(true)}
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

        <TagManagerDialog open={tagManagerOpen} onClose={() => setTagManagerOpen(false)} />
        <NotificationsDrawer />
        <QuickAddDialog
          open={effectiveQuickAddOpen}
          onClose={handleCloseQuickAdd}
          initialValues={quickAddInitialValues}
        />
        <UploadFileDialog
          open={uploadDialogOpen}
          onClose={() => setUploadDialogOpen(false)}
          initialCollectionId={routeCollectionId}
        />

        <DragOverlay>
          {dragOverlayLabel ? (
            <Paper elevation={4} sx={{ px: 1.5, py: 0.75, pointerEvents: 'none' }}>
              <Typography variant="body2" noWrap sx={{ maxWidth: 240 }}>
                {dragOverlayLabel}
              </Typography>
            </Paper>
          ) : null}
        </DragOverlay>
      </DndContext>
    </AppDndContext.Provider>
  );
}
