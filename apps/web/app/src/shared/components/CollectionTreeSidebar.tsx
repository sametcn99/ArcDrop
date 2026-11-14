import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import ArrowDownwardOutlinedIcon from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlinedIcon from '@mui/icons-material/ArrowUpwardOutlined';
import CallMergeOutlinedIcon from '@mui/icons-material/CallMergeOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DragIndicatorOutlinedIcon from '@mui/icons-material/DragIndicatorOutlined';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';
import { collectionsApi } from '../../api/endpoints/collections';
import type { Collection, CollectionNode } from '../../api/schemas/collections';
import { selectSortedCollections, useLibraryStore } from '../../stores/libraryStore';
import { useSyncStore } from '../../stores/syncStore';
import {
  moveCollectionParentAction,
  reorderSiblingCollectionsAction,
} from '../actions/collectionActions';
import {
  buildCollectionDragId,
  buildCollectionDropId,
  buildCollectionReorderId,
  COLLECTION_ROOT_DROP_ID,
  useAppDnd,
  type DragItemData,
  type DropTargetData,
} from '../hooks/useAppDnd';
import { SHARED_COLLECTION_STRINGS } from '../strings';
import { buildCollectionTree, getSiblingCollections } from '../utils/collectionTree';
import { CollectionDeleteDialog } from './CollectionDeleteDialog';
import { CollectionFormDialog } from './CollectionFormDialog';
import { CollectionIcon } from './CollectionIcon';
import { CollectionMergeDialog } from './CollectionMergeDialog';
import { CollectionShareDialog } from './CollectionShareDialog';

export interface CollectionTreeSidebarProps {
  enableDnd?: boolean;
  onNavigate?: () => void;
}

type TreeFilterMode = 'all' | 'shared';

interface ContextMenuTarget {
  collection: Collection;
  siblings: Collection[];
  siblingIndex: number;
  anchorEl: HTMLElement | null;
  anchorPosition: { top: number; left: number } | null;
}

function ReorderDropSlot({
  node,
  enableDnd,
  visible,
}: {
  node: CollectionNode;
  enableDnd: boolean;
  visible: boolean;
}) {
  const dropData: DropTargetData = {
    kind: 'collection-reorder',
    targetId: node.id,
    parentId: node.parentId,
    position: 'before',
  };

  const { setNodeRef, isOver } = useDroppable({
    id: buildCollectionReorderId(node.id, 'before'),
    data: dropData,
    disabled: !enableDnd || !visible,
  });

  if (!enableDnd || !visible) {
    return null;
  }

  return (
    <Box
      ref={setNodeRef}
      data-testid={`col-reorder-slot-${node.id}`}
      aria-label={`${SHARED_COLLECTION_STRINGS.reorderSlotLabel}: ${node.title}`}
      sx={{
        height: isOver ? 8 : 4,
        mx: 1,
        borderRadius: 1,
        bgcolor: isOver ? 'primary.main' : 'action.hover',
        transition: 'all 120ms ease',
      }}
    />
  );
}

function RootDropZone({ enableDnd, visible }: { enableDnd: boolean; visible: boolean }) {
  const dropData: DropTargetData = { kind: 'collection-root-drop' };
  const { setNodeRef, isOver } = useDroppable({
    id: COLLECTION_ROOT_DROP_ID,
    data: dropData,
    disabled: !enableDnd || !visible,
  });

  if (!enableDnd || !visible) {
    return null;
  }

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      data-testid="col-root-drop-zone"
      sx={{
        p: 0.75,
        mb: 1,
        textAlign: 'center',
        borderStyle: 'dashed',
        borderColor: isOver ? 'primary.main' : 'divider',
        bgcolor: isOver ? 'action.selected' : 'background.default',
      }}
    >
      <Typography variant="caption" color={isOver ? 'primary.main' : 'text.secondary'}>
        {SHARED_COLLECTION_STRINGS.moveToRootDropLabel}
      </Typography>
    </Paper>
  );
}

function DndCollectionRowWrapper({
  node,
  enableDnd,
  children,
}: {
  node: CollectionNode;
  enableDnd: boolean;
  children: (bindings: {
    setDropRef: (el: HTMLElement | null) => void;
    setDragRef: (el: HTMLElement | null) => void;
    setActivatorRef: (el: HTMLElement | null) => void;
    attributes: ReturnType<typeof useDraggable>['attributes'] | undefined;
    listeners: ReturnType<typeof useDraggable>['listeners'] | undefined;
    isOver: boolean;
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const dragData: DragItemData = {
    kind: 'collection',
    collectionId: node.id,
    parentId: node.parentId,
    title: node.title,
  };
  const dropData: DropTargetData = {
    kind: 'collection-drop',
    collectionId: node.id,
  };

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: buildCollectionDropId(node.id),
    data: dropData,
    disabled: !enableDnd,
  });

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    setActivatorNodeRef: setActivatorRef,
    isDragging,
  } = useDraggable({
    id: buildCollectionDragId(node.id),
    data: dragData,
    disabled: !enableDnd,
  });

  return (
    <>
      {children({
        setDropRef,
        setDragRef,
        setActivatorRef,
        attributes: enableDnd ? attributes : undefined,
        listeners: enableDnd ? listeners : undefined,
        isOver: enableDnd && isOver,
        isDragging: enableDnd && isDragging,
      })}
    </>
  );
}

function StaticCollectionRowWrapper({
  children,
}: {
  children: (bindings: {
    setDropRef: (el: HTMLElement | null) => void;
    setDragRef: (el: HTMLElement | null) => void;
    setActivatorRef: (el: HTMLElement | null) => void;
    attributes: ReturnType<typeof useDraggable>['attributes'] | undefined;
    listeners: ReturnType<typeof useDraggable>['listeners'] | undefined;
    isOver: boolean;
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const noop = () => undefined;
  return (
    <>
      {children({
        setDropRef: noop,
        setDragRef: noop,
        setActivatorRef: noop,
        attributes: undefined,
        listeners: undefined,
        isOver: false,
        isDragging: false,
      })}
    </>
  );
}

function CollectionTreeBranch({
  nodes,
  depth,
  activeCollectionId,
  expandedIds,
  enableDnd,
  onToggleExpand,
  onNavigate,
  onOpenMenu,
}: {
  nodes: CollectionNode[];
  depth: number;
  activeCollectionId: string | null;
  expandedIds: Record<string, boolean>;
  enableDnd: boolean;
  onToggleExpand: (id: string) => void;
  onNavigate?: () => void;
  onOpenMenu: (target: ContextMenuTarget) => void;
}) {
  const { activeDrag } = useAppDnd();
  const showReorderSlots = activeDrag?.kind === 'collection';

  return (
    <List dense disablePadding>
      {nodes.map((node, index) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = Boolean(expandedIds[node.id]);
        const isSelected = activeCollectionId === node.id;

        const handleOpenButtonMenu = (event: MouseEvent<HTMLElement>) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenMenu({
            collection: node,
            siblings: nodes,
            siblingIndex: index,
            anchorEl: event.currentTarget,
            anchorPosition: null,
          });
        };

        const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenMenu({
            collection: node,
            siblings: nodes,
            siblingIndex: index,
            anchorEl: null,
            anchorPosition: { top: event.clientY, left: event.clientX },
          });
        };

        const rowRenderer = (bindings: {
          setDropRef: (el: HTMLElement | null) => void;
          setDragRef: (el: HTMLElement | null) => void;
          setActivatorRef: (el: HTMLElement | null) => void;
          attributes: ReturnType<typeof useDraggable>['attributes'] | undefined;
          listeners: ReturnType<typeof useDraggable>['listeners'] | undefined;
          isOver: boolean;
          isDragging: boolean;
        }) => {
          const isDropValid =
            bindings.isOver &&
            !(activeDrag?.kind === 'collection' && activeDrag.collectionId === node.id);

          return (
            <Box ref={bindings.setDragRef} sx={{ opacity: bindings.isDragging ? 0.45 : 1 }}>
              <ReorderDropSlot
                node={node}
                enableDnd={enableDnd}
                visible={showReorderSlots && activeDrag?.collectionId !== node.id}
              />

              <ListItem
                ref={bindings.setDropRef}
                disablePadding
                data-testid={`col-tree-row-${node.id}`}
                onContextMenu={handleContextMenu}
                sx={{
                  pl: depth * 1.75,
                  borderRadius: 1,
                  bgcolor: isDropValid ? 'action.selected' : undefined,
                  outline: isDropValid ? 2 : 0,
                  outlineStyle: isDropValid ? 'solid' : 'none',
                  outlineColor: isDropValid ? 'primary.main' : 'transparent',
                }}
                secondaryAction={
                  <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
                    {enableDnd ? (
                      <IconButton
                        ref={bindings.setActivatorRef}
                        size="small"
                        aria-label={`${SHARED_COLLECTION_STRINGS.dragCollectionLabel}: ${node.title}`}
                        data-testid={`col-drag-handle-${node.id}`}
                        sx={{ cursor: 'grab', touchAction: 'none' }}
                        {...bindings.attributes}
                        {...bindings.listeners}
                      >
                        <DragIndicatorOutlinedIcon fontSize="inherit" />
                      </IconButton>
                    ) : null}
                    <IconButton
                      size="small"
                      edge="end"
                      aria-label={`${SHARED_COLLECTION_STRINGS.collectionActionsLabel}: ${node.title}`}
                      data-testid={`col-actions-${node.id}`}
                      onClick={handleOpenButtonMenu}
                    >
                      <MoreVertIcon fontSize="inherit" />
                    </IconButton>
                  </Stack>
                }
              >
                {hasChildren ? (
                  <IconButton
                    size="small"
                    aria-label={
                      isExpanded
                        ? `${SHARED_COLLECTION_STRINGS.collapseCollectionLabel}: ${node.title}`
                        : `${SHARED_COLLECTION_STRINGS.expandCollectionLabel}: ${node.title}`
                    }
                    onClick={() => onToggleExpand(node.id)}
                    sx={{ mr: 0.25 }}
                  >
                    {isExpanded ? (
                      <ExpandMoreIcon fontSize="small" />
                    ) : (
                      <ChevronRightIcon fontSize="small" />
                    )}
                  </IconButton>
                ) : (
                  <Box sx={{ width: 28, flexShrink: 0 }} />
                )}

                <ListItemButton
                  component={RouterLink}
                  to={`/collections/${node.id}`}
                  selected={isSelected}
                  onClick={onNavigate}
                  sx={{ borderRadius: 1, pr: enableDnd ? 7.5 : 4.5, py: 0.5, minWidth: 0 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <CollectionIcon iconName={node.icon} colorValue={node.color} fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{ alignItems: 'center', minWidth: 0 }}
                      >
                        <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
                          {node.title}
                        </Typography>
                        {node.share.enabled ? (
                          <Tooltip title={SHARED_COLLECTION_STRINGS.sharedBadgeTooltip}>
                            <PublicOutlinedIcon fontSize="inherit" color="primary" />
                          </Tooltip>
                        ) : null}
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {node.bookmarkCount}
                        </Typography>
                      </Stack>
                    }
                  />
                </ListItemButton>
              </ListItem>

              {hasChildren ? (
                <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                  <CollectionTreeBranch
                    nodes={node.children}
                    depth={depth + 1}
                    activeCollectionId={activeCollectionId}
                    expandedIds={expandedIds}
                    enableDnd={enableDnd}
                    onToggleExpand={onToggleExpand}
                    onNavigate={onNavigate}
                    onOpenMenu={onOpenMenu}
                  />
                </Collapse>
              ) : null}
            </Box>
          );
        };

        return enableDnd ? (
          <DndCollectionRowWrapper key={node.id} node={node} enableDnd={enableDnd}>
            {rowRenderer}
          </DndCollectionRowWrapper>
        ) : (
          <StaticCollectionRowWrapper key={node.id}>{rowRenderer}</StaticCollectionRowWrapper>
        );
      })}
    </List>
  );
}

export function CollectionTreeSidebar({
  enableDnd = true,
  onNavigate,
}: CollectionTreeSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeDrag } = useAppDnd();

  const collectionsById = useLibraryStore((s) => s.collectionsById);
  const expandedIds = useLibraryStore((s) => s.expandedCollectionIds);
  const toggleCollectionExpanded = useLibraryStore((s) => s.toggleCollectionExpanded);
  const syncExpandedFromStorage = useLibraryStore((s) => s.syncExpandedFromStorage);
  const isBootstrapping = useSyncStore((s) => s.isBootstrapping);

  const [filterMode, setFilterMode] = useState<TreeFilterMode>('all');
  const [sharedItems, setSharedItems] = useState<Collection[] | null>(null);
  const [loadingShared, setLoadingShared] = useState(false);

  const [menuTarget, setMenuTarget] = useState<ContextMenuTarget | null>(null);
  const [formDialog, setFormDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    collection: Collection | null;
    defaultParentId: string | null;
  }>({
    open: false,
    mode: 'create',
    collection: null,
    defaultParentId: null,
  });
  const [deleteDialogCollection, setDeleteDialogCollection] = useState<Collection | null>(null);
  const [shareDialogCollection, setShareDialogCollection] = useState<Collection | null>(null);
  const [mergeDialogState, setMergeDialogState] = useState<{
    open: boolean;
    initialSourceId: string | null;
  }>({ open: false, initialSourceId: null });

  useEffect(() => {
    syncExpandedFromStorage();
  }, [syncExpandedFromStorage]);

  useEffect(() => {
    if (filterMode !== 'shared') {
      return;
    }
    let cancelled = false;
    void collectionsApi
      .list({ shared: true })
      .then((res) => {
        if (!cancelled) {
          setSharedItems(res.items);
          setLoadingShared(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSharedItems(
            Object.values(useLibraryStore.getState().collectionsById).filter(
              (item) => item.share.enabled,
            ),
          );
          setLoadingShared(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [collectionsById, filterMode]);

  const sortedCollections = useMemo(
    () =>
      selectSortedCollections({ collectionsById } as Parameters<typeof selectSortedCollections>[0]),
    [collectionsById],
  );

  const treeNodes = useMemo(() => buildCollectionTree(sortedCollections), [sortedCollections]);

  const activeCollectionId = useMemo(() => {
    const match = /^\/collections\/([^/]+)$/.exec(location.pathname);
    return match ? decodeURIComponent(match[1] ?? '') : null;
  }, [location.pathname]);

  const handleCloseMenu = () => {
    setMenuTarget(null);
  };

  const handleMoveSibling = async (collection: Collection, direction: 'up' | 'down') => {
    const siblings = getSiblingCollections(collectionsById, collection.parentId);
    const index = siblings.findIndex((item) => item.id === collection.id);
    if (index === -1) return;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= siblings.length) return;

    const reordered = [...siblings];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(swapIndex, 0, moved);

    const payload = reordered.map((item, idx) => ({ id: item.id, order: idx }));
    await reorderSiblingCollectionsAction(payload).catch(() => undefined);
  };

  const menuOpen = Boolean(menuTarget);
  const showRootDrop = activeDrag?.kind === 'collection' && activeDrag.parentId !== null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
          <Typography variant="overline" color="text.secondary">
            {SHARED_COLLECTION_STRINGS.sidebarHeading}
          </Typography>
          <Chip size="small" label={sortedCollections.length} variant="outlined" />
        </Stack>

        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
          <Tooltip title={SHARED_COLLECTION_STRINGS.mergeCollectionsTooltip}>
            <Box component="span" sx={{ display: 'inline-flex' }}>
              <IconButton
                size="small"
                aria-label={SHARED_COLLECTION_STRINGS.mergeCollectionsAriaLabel}
                disabled={sortedCollections.length < 2}
                onClick={() => setMergeDialogState({ open: true, initialSourceId: null })}
              >
                <CallMergeOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>
          </Tooltip>
          <Tooltip title={SHARED_COLLECTION_STRINGS.newCollectionTooltip}>
            <IconButton
              size="small"
              aria-label={SHARED_COLLECTION_STRINGS.newCollectionAriaLabel}
              onClick={() =>
                setFormDialog({
                  open: true,
                  mode: 'create',
                  collection: null,
                  defaultParentId: null,
                })
              }
            >
              <AddOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={filterMode}
        aria-label={SHARED_COLLECTION_STRINGS.sidebarHeading}
        onChange={(_event, next: TreeFilterMode | null) => {
          if (next) {
            if (next === 'shared') {
              setLoadingShared(true);
            }
            setFilterMode(next);
          }
        }}
      >
        <ToggleButton value="all">{SHARED_COLLECTION_STRINGS.filterAll}</ToggleButton>
        <ToggleButton value="shared">{SHARED_COLLECTION_STRINGS.filterShared}</ToggleButton>
      </ToggleButtonGroup>

      {isBootstrapping && sortedCollections.length === 0 ? (
        <Stack spacing={1}>
          <Skeleton variant="rounded" height={28} />
          <Skeleton variant="rounded" height={28} />
          <Skeleton variant="rounded" height={28} />
        </Stack>
      ) : filterMode === 'shared' ? (
        loadingShared && sharedItems === null ? (
          <Stack spacing={1}>
            <Skeleton variant="rounded" height={28} />
            <Skeleton variant="rounded" height={28} />
          </Stack>
        ) : (sharedItems ?? []).length === 0 ? (
          <Box sx={{ py: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              {SHARED_COLLECTION_STRINGS.sharedEmptyTitle}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {SHARED_COLLECTION_STRINGS.sharedEmptyHint}
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding data-testid="shared-collections-list">
            {(sharedItems ?? []).map((col) => (
              <ListItem
                key={col.id}
                disablePadding
                secondaryAction={
                  <IconButton
                    size="small"
                    aria-label={`${SHARED_COLLECTION_STRINGS.menuShare}: ${col.title}`}
                    onClick={() => setShareDialogCollection(col)}
                  >
                    <ShareOutlinedIcon fontSize="inherit" />
                  </IconButton>
                }
              >
                <ListItemButton
                  component={RouterLink}
                  to={`/collections/${col.id}`}
                  selected={activeCollectionId === col.id}
                  onClick={onNavigate}
                  sx={{ borderRadius: 1, pr: 5, py: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <CollectionIcon iconName={col.icon} colorValue={col.color} fontSize="small" />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>
                          {col.title}
                        </Typography>
                        <PublicOutlinedIcon fontSize="inherit" color="primary" />
                        <Typography variant="caption" color="text.secondary">
                          {col.bookmarkCount}
                        </Typography>
                      </Stack>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )
      ) : treeNodes.length === 0 ? (
        <Box sx={{ py: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            {SHARED_COLLECTION_STRINGS.emptyTreeTitle}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {SHARED_COLLECTION_STRINGS.emptyTreeHint}
          </Typography>
        </Box>
      ) : (
        <Box data-testid="collection-tree-list">
          <RootDropZone enableDnd={enableDnd} visible={showRootDrop} />
          <CollectionTreeBranch
            nodes={treeNodes}
            depth={0}
            activeCollectionId={activeCollectionId}
            expandedIds={expandedIds}
            enableDnd={enableDnd}
            onToggleExpand={toggleCollectionExpanded}
            onNavigate={onNavigate}
            onOpenMenu={setMenuTarget}
          />
        </Box>
      )}

      <Menu
        open={menuOpen}
        onClose={handleCloseMenu}
        anchorEl={menuTarget?.anchorEl ?? undefined}
        anchorReference={menuTarget?.anchorPosition ? 'anchorPosition' : 'anchorEl'}
        anchorPosition={menuTarget?.anchorPosition ?? undefined}
      >
        {menuTarget
          ? [
              <MenuItem
                key="open"
                onClick={() => {
                  const id = menuTarget.collection.id;
                  handleCloseMenu();
                  onNavigate?.();
                  navigate(`/collections/${id}`);
                }}
              >
                <ListItemIcon>
                  <FolderOpenOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={SHARED_COLLECTION_STRINGS.menuOpen} />
              </MenuItem>,
              <MenuItem
                key="add-child"
                onClick={() => {
                  const parentId = menuTarget.collection.id;
                  handleCloseMenu();
                  setFormDialog({
                    open: true,
                    mode: 'create',
                    collection: null,
                    defaultParentId: parentId,
                  });
                }}
              >
                <ListItemIcon>
                  <AddOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={SHARED_COLLECTION_STRINGS.menuAddChild} />
              </MenuItem>,
              <MenuItem
                key="edit"
                onClick={() => {
                  const col = menuTarget.collection;
                  handleCloseMenu();
                  setFormDialog({
                    open: true,
                    mode: 'edit',
                    collection: col,
                    defaultParentId: col.parentId,
                  });
                }}
              >
                <ListItemIcon>
                  <EditOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={SHARED_COLLECTION_STRINGS.menuEdit} />
              </MenuItem>,
              <MenuItem
                key="share"
                onClick={() => {
                  const col = menuTarget.collection;
                  handleCloseMenu();
                  setShareDialogCollection(col);
                }}
              >
                <ListItemIcon>
                  <ShareOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={SHARED_COLLECTION_STRINGS.menuShare} />
              </MenuItem>,
              <MenuItem
                key="merge"
                disabled={sortedCollections.length < 2}
                onClick={() => {
                  const col = menuTarget.collection;
                  handleCloseMenu();
                  setMergeDialogState({ open: true, initialSourceId: col.id });
                }}
              >
                <ListItemIcon>
                  <CallMergeOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={SHARED_COLLECTION_STRINGS.menuMerge} />
              </MenuItem>,
              <Divider key="divider-order" />,
              <MenuItem
                key="move-up"
                disabled={menuTarget.siblingIndex <= 0}
                onClick={() => {
                  const col = menuTarget.collection;
                  handleCloseMenu();
                  void handleMoveSibling(col, 'up');
                }}
              >
                <ListItemIcon>
                  <ArrowUpwardOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={SHARED_COLLECTION_STRINGS.menuMoveUp} />
              </MenuItem>,
              <MenuItem
                key="move-down"
                disabled={menuTarget.siblingIndex >= menuTarget.siblings.length - 1}
                onClick={() => {
                  const col = menuTarget.collection;
                  handleCloseMenu();
                  void handleMoveSibling(col, 'down');
                }}
              >
                <ListItemIcon>
                  <ArrowDownwardOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={SHARED_COLLECTION_STRINGS.menuMoveDown} />
              </MenuItem>,
              menuTarget.collection.parentId ? (
                <MenuItem
                  key="move-root"
                  onClick={() => {
                    const col = menuTarget.collection;
                    handleCloseMenu();
                    void moveCollectionParentAction(col.id, null).catch(() => undefined);
                  }}
                >
                  <ListItemIcon>
                    <DriveFileMoveOutlinedIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={SHARED_COLLECTION_STRINGS.menuMoveToRoot} />
                </MenuItem>
              ) : null,
              <Divider key="divider-delete" />,
              <MenuItem
                key="delete"
                onClick={() => {
                  const col = menuTarget.collection;
                  handleCloseMenu();
                  setDeleteDialogCollection(col);
                }}
              >
                <ListItemIcon>
                  <DeleteOutlineOutlinedIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText
                  primary={SHARED_COLLECTION_STRINGS.menuDelete}
                  slotProps={{ primary: { color: 'error' } }}
                />
              </MenuItem>,
            ]
          : null}
      </Menu>

      <CollectionFormDialog
        open={formDialog.open}
        mode={formDialog.mode}
        initialCollection={formDialog.collection}
        defaultParentId={formDialog.defaultParentId}
        onClose={() =>
          setFormDialog((prev) => ({
            ...prev,
            open: false,
          }))
        }
      />

      <CollectionDeleteDialog
        open={Boolean(deleteDialogCollection)}
        collection={deleteDialogCollection}
        onClose={() => setDeleteDialogCollection(null)}
        onDeleted={(deletedId) => {
          if (activeCollectionId === deletedId) {
            navigate('/');
          }
        }}
      />

      <CollectionShareDialog
        open={Boolean(shareDialogCollection)}
        collection={shareDialogCollection}
        onClose={() => setShareDialogCollection(null)}
      />

      <CollectionMergeDialog
        open={mergeDialogState.open}
        initialSourceId={mergeDialogState.initialSourceId}
        onClose={() => setMergeDialogState({ open: false, initialSourceId: null })}
        onMerged={(result) => {
          if (activeCollectionId && result.trashedIds.includes(activeCollectionId)) {
            navigate(`/collections/${result.target.id}`);
          }
        }}
      />
    </Box>
  );
}
