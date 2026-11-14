import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { toggleBookmarkFavoriteAction } from '../../shared/actions/bookmarkActions';
import { BookmarkLayouts } from '../../shared/components/BookmarkLayouts';
import { CollectionDeleteDialog } from '../../shared/components/CollectionDeleteDialog';
import { CollectionFormDialog } from '../../shared/components/CollectionFormDialog';
import { CollectionMergeDialog } from '../../shared/components/CollectionMergeDialog';
import { CollectionShareDialog } from '../../shared/components/CollectionShareDialog';
import { useAppDnd, type DragItemData } from '../../shared/hooks/useAppDnd';
import { CollectionToolbar } from './components/CollectionToolbar';
import { useCollectionView } from './hooks/useCollectionView';
import { COLLECTION_PAGE_STRINGS } from './strings';

export default function CollectionPage() {
  const navigate = useNavigate();
  const { hasProvider } = useAppDnd();
  const {
    collection,
    ancestors,
    collectionNotFound,
    sort,
    layoutMode,
    setLayoutMode,
    setSort,
    items,
    totalCount,
    hasMore,
    loading,
    loadingMore,
    error,
    selectedBookmarkIds,
    toggleBookmarkSelection,
    loadMore,
    retry,
    reorderBookmarks,
    moveBookmark,
  } = useCollectionView();

  const [shareOpen, setShareOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const fallbackSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleFallbackDragEnd = (event: DragEndEvent) => {
    if (sort !== 'manual') return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeData = active.data.current as DragItemData | undefined;
    const overData = over.data.current as DragItemData | undefined;
    if (activeData?.kind !== 'bookmark' || overData?.kind !== 'bookmark') return;

    const currentIds = items.map((item) => item.id);
    const oldIndex = currentIds.indexOf(activeData.bookmarkId);
    const newIndex = currentIds.indexOf(overData.bookmarkId);
    if (oldIndex === -1 || newIndex === -1) return;
    void reorderBookmarks(arrayMove(currentIds, oldIndex, newIndex));
  };

  if (collectionNotFound) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h5" component="h1">
          {COLLECTION_PAGE_STRINGS.notFoundTitle}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          {COLLECTION_PAGE_STRINGS.notFoundDescription}
        </Typography>
        <Button component={RouterLink} to="/" variant="contained">
          {COLLECTION_PAGE_STRINGS.notFoundAction}
        </Button>
      </Paper>
    );
  }

  const layoutsElement = (
    <BookmarkLayouts
      items={items}
      layoutMode={layoutMode}
      selectedBookmarkIds={selectedBookmarkIds}
      draggableBookmarks={true}
      sortableBookmarks={sort === 'manual'}
      onMoveBookmark={(bookmarkId, direction) => {
        void moveBookmark(bookmarkId, direction);
      }}
      onToggleFavorite={(bookmark) => {
        void toggleBookmarkFavoriteAction(bookmark).catch(() => undefined);
      }}
      onToggleSelect={toggleBookmarkSelection}
    />
  );

  return (
    <Stack spacing={3}>
      <CollectionToolbar
        collection={collection}
        ancestors={ancestors}
        sort={sort}
        layoutMode={layoutMode}
        totalCount={totalCount}
        onSortChange={setSort}
        onLayoutChange={setLayoutMode}
        onShare={() => setShareOpen(true)}
        onEdit={() => setEditOpen(true)}
        onMerge={() => setMergeOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      />

      {sort === 'manual' && items.length > 0 ? (
        <Alert severity="info">{COLLECTION_PAGE_STRINGS.manualOrderHint}</Alert>
      ) : null}

      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={retry}>
              {COLLECTION_PAGE_STRINGS.errorRetryLabel}
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Stack spacing={1.5}>
          <Skeleton variant="rounded" height={96} />
          <Skeleton variant="rounded" height={96} />
          <Skeleton variant="rounded" height={96} />
        </Stack>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6">{COLLECTION_PAGE_STRINGS.emptyTitle}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {COLLECTION_PAGE_STRINGS.emptyDescription}
          </Typography>
        </Paper>
      ) : (
        <>
          {hasProvider ? (
            layoutsElement
          ) : (
            <DndContext
              sensors={fallbackSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleFallbackDragEnd}
            >
              {layoutsElement}
            </DndContext>
          )}

          {hasMore ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
              <Button variant="outlined" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore
                  ? COLLECTION_PAGE_STRINGS.loadingMoreLabel
                  : COLLECTION_PAGE_STRINGS.loadMoreLabel}
              </Button>
            </Box>
          ) : null}
        </>
      )}

      <CollectionShareDialog
        open={shareOpen}
        collection={collection}
        onClose={() => setShareOpen(false)}
      />

      <CollectionFormDialog
        open={editOpen}
        mode="edit"
        initialCollection={collection}
        onClose={() => setEditOpen(false)}
      />

      <CollectionMergeDialog
        open={mergeOpen}
        initialSourceId={collection?.id ?? null}
        onClose={() => setMergeOpen(false)}
        onMerged={(result) => {
          if (collection && result.trashedIds.includes(collection.id)) {
            navigate(`/collections/${result.target.id}`);
          }
        }}
      />

      <CollectionDeleteDialog
        open={deleteOpen}
        collection={collection}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          navigate('/');
        }}
      />
    </Stack>
  );
}
