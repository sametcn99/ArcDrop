import ArrowDownwardOutlinedIcon from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlinedIcon from '@mui/icons-material/ArrowUpwardOutlined';
import DragIndicatorOutlinedIcon from '@mui/icons-material/DragIndicatorOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import { useDraggable } from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import type { Bookmark } from '../../api/schemas/bookmarks';
import type { LibraryLayoutMode } from '../../stores/libraryStore';
import { buildBookmarkDragId, type DragItemData } from '../hooks/useAppDnd';
import { SHARED_BOOKMARK_STRINGS } from '../strings';
import { BookmarkIconBadge } from './BookmarkIconBadge';
import { ContentTypeChip } from './ContentTypeChip';
import { FavoriteToggleButton } from './FavoriteToggleButton';
import { TagChipList } from './TagChipList';

export interface BookmarkLayoutsProps {
  items: Bookmark[];
  layoutMode: LibraryLayoutMode;
  selectedBookmarkIds: Record<string, true>;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onToggleSelect: (id: string) => void;
  draggableBookmarks?: boolean;
  sortableBookmarks?: boolean;
  onMoveBookmark?: (bookmarkId: string, direction: 'up' | 'down') => void;
}

interface BookmarkItemBindings {
  setNodeRef: (node: HTMLElement | null) => void;
  dragHandle: ReactNode;
  transformStyle: string | undefined;
  transitionStyle: string | undefined;
  isDragging: boolean;
}

function resolveBookmarkTitle(bookmark: Bookmark): string {
  return (
    bookmark.title ?? bookmark.fileName ?? bookmark.url ?? SHARED_BOOKMARK_STRINGS.untitledBookmark
  );
}

function resolveBookmarkSourceLabel(bookmark: Bookmark): string {
  if (bookmark.storageKind === 'file') {
    return bookmark.fileName ?? SHARED_BOOKMARK_STRINGS.fileItemLabel;
  }
  return bookmark.urlParts?.host ?? bookmark.url ?? '';
}

function BookmarkExternalAction({ bookmark }: { bookmark: Bookmark }) {
  if (!bookmark.url) return null;
  return (
    <Tooltip title={bookmark.url}>
      <IconButton
        component="a"
        href={bookmark.url}
        target="_blank"
        rel="noopener noreferrer"
        size="small"
        aria-label={`Open external URL for ${resolveBookmarkTitle(bookmark)}`}
      >
        <OpenInNewOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function SortableBookmarkShell({
  bookmark,
  title,
  children,
}: {
  bookmark: Bookmark;
  title: string;
  children: (bindings: BookmarkItemBindings) => ReactNode;
}) {
  const dragData: DragItemData = {
    kind: 'bookmark',
    bookmarkId: bookmark.id,
    bookmark,
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: buildBookmarkDragId(bookmark.id),
    data: dragData,
  });

  const dragHandle = (
    <Tooltip title={SHARED_BOOKMARK_STRINGS.dragBookmarkLabel}>
      <IconButton
        ref={setActivatorNodeRef}
        size="small"
        aria-label={`${SHARED_BOOKMARK_STRINGS.dragBookmarkLabel}: ${title}`}
        data-testid={`bookmark-drag-handle-${bookmark.id}`}
        sx={{ cursor: 'grab', touchAction: 'none' }}
        {...attributes}
        {...listeners}
      >
        <DragIndicatorOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );

  return (
    <>
      {children({
        setNodeRef,
        dragHandle,
        transformStyle: CSS.Transform.toString(transform),
        transitionStyle: transition,
        isDragging,
      })}
    </>
  );
}

function DraggableBookmarkShell({
  bookmark,
  title,
  enabled,
  children,
}: {
  bookmark: Bookmark;
  title: string;
  enabled: boolean;
  children: (bindings: BookmarkItemBindings) => ReactNode;
}) {
  const dragData: DragItemData = {
    kind: 'bookmark',
    bookmarkId: bookmark.id,
    bookmark,
  };

  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({
      id: buildBookmarkDragId(bookmark.id),
      data: dragData,
      disabled: !enabled,
    });

  const dragHandle = enabled ? (
    <Tooltip title={SHARED_BOOKMARK_STRINGS.dragBookmarkLabel}>
      <IconButton
        ref={setActivatorNodeRef}
        size="small"
        aria-label={`${SHARED_BOOKMARK_STRINGS.dragBookmarkLabel}: ${title}`}
        data-testid={`bookmark-drag-handle-${bookmark.id}`}
        sx={{ cursor: 'grab', touchAction: 'none' }}
        {...attributes}
        {...listeners}
      >
        <DragIndicatorOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  ) : null;

  return (
    <>
      {children({
        setNodeRef,
        dragHandle,
        transformStyle: CSS.Translate.toString(transform),
        transitionStyle: undefined,
        isDragging,
      })}
    </>
  );
}

function BookmarkItemWrapper({
  bookmark,
  title,
  sortable,
  draggable,
  children,
}: {
  bookmark: Bookmark;
  title: string;
  sortable: boolean;
  draggable: boolean;
  children: (bindings: BookmarkItemBindings) => ReactNode;
}) {
  if (sortable) {
    return (
      <SortableBookmarkShell bookmark={bookmark} title={title}>
        {children}
      </SortableBookmarkShell>
    );
  }
  return (
    <DraggableBookmarkShell bookmark={bookmark} title={title} enabled={draggable}>
      {children}
    </DraggableBookmarkShell>
  );
}

function BookmarkDragAndOrderControls({
  bookmark,
  title,
  dragHandle,
  draggable,
  sortable,
  index,
  total,
  onMoveBookmark,
}: {
  bookmark: Bookmark;
  title: string;
  dragHandle: ReactNode;
  draggable: boolean;
  sortable: boolean;
  index: number;
  total: number;
  onMoveBookmark?: (bookmarkId: string, direction: 'up' | 'down') => void;
}) {
  if (!draggable && !sortable) return null;
  return (
    <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
      {dragHandle}
      {sortable && onMoveBookmark ? (
        <>
          <Tooltip title={SHARED_BOOKMARK_STRINGS.moveBookmarkUpLabel}>
            <Box component="span" sx={{ display: 'inline-flex' }}>
              <IconButton
                size="small"
                disabled={index === 0}
                aria-label={`${SHARED_BOOKMARK_STRINGS.moveBookmarkUpLabel}: ${title}`}
                onClick={() => onMoveBookmark(bookmark.id, 'up')}
              >
                <ArrowUpwardOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>
          </Tooltip>
          <Tooltip title={SHARED_BOOKMARK_STRINGS.moveBookmarkDownLabel}>
            <Box component="span" sx={{ display: 'inline-flex' }}>
              <IconButton
                size="small"
                disabled={index === total - 1}
                aria-label={`${SHARED_BOOKMARK_STRINGS.moveBookmarkDownLabel}: ${title}`}
                onClick={() => onMoveBookmark(bookmark.id, 'down')}
              >
                <ArrowDownwardOutlinedIcon fontSize="small" />
              </IconButton>
            </Box>
          </Tooltip>
        </>
      ) : null}
    </Stack>
  );
}

function ListLayout({
  items,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  draggableBookmarks = true,
  sortableBookmarks = false,
  onMoveBookmark,
}: Omit<BookmarkLayoutsProps, 'layoutMode'>) {
  return (
    <Stack spacing={1.5} data-testid="library-layout-list">
      {items.map((bookmark, index) => {
        const title = resolveBookmarkTitle(bookmark);
        const sourceLabel = resolveBookmarkSourceLabel(bookmark);
        const checked = Boolean(selectedBookmarkIds[bookmark.id]);

        return (
          <BookmarkItemWrapper
            key={bookmark.id}
            bookmark={bookmark}
            title={title}
            sortable={sortableBookmarks}
            draggable={draggableBookmarks}
          >
            {(bindings) => (
              <Card
                ref={bindings.setNodeRef}
                variant="outlined"
                data-testid={`bookmark-item-${bookmark.id}`}
                sx={{
                  transform: bindings.transformStyle,
                  transition: bindings.transitionStyle,
                  opacity: bindings.isDragging ? 0.5 : 1,
                }}
              >
                <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
                  >
                    <Checkbox
                      size="small"
                      checked={checked}
                      onChange={() => onToggleSelect(bookmark.id)}
                      slotProps={{
                        input: {
                          'aria-label': `${SHARED_BOOKMARK_STRINGS.selectBookmarkLabel}: ${title}`,
                        },
                      }}
                      sx={{ mt: -0.5 }}
                    />

                    <BookmarkIconBadge
                      iconRef={bookmark.iconRef}
                      contentType={bookmark.contentType}
                      alt={title}
                    />

                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Link
                        component={RouterLink}
                        to={`/bookmarks/${bookmark.id}`}
                        underline="hover"
                        color="text.primary"
                        variant="subtitle1"
                        sx={{ fontWeight: 600, display: 'block' }}
                      >
                        {title}
                      </Link>
                      {sourceLabel ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          sx={{ display: 'block' }}
                        >
                          {sourceLabel}
                        </Typography>
                      ) : null}
                      {bookmark.excerpt ? (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                          {bookmark.excerpt}
                        </Typography>
                      ) : null}
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ mt: 1.25, alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
                      >
                        <ContentTypeChip contentType={bookmark.contentType} />
                        <TagChipList tags={bookmark.tags} maxVisible={5} />
                      </Stack>
                    </Box>

                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ alignItems: 'center', flexShrink: 0 }}
                    >
                      <BookmarkDragAndOrderControls
                        bookmark={bookmark}
                        title={title}
                        dragHandle={bindings.dragHandle}
                        draggable={draggableBookmarks}
                        sortable={sortableBookmarks}
                        index={index}
                        total={items.length}
                        onMoveBookmark={onMoveBookmark}
                      />
                      <FavoriteToggleButton
                        favorite={bookmark.favorite}
                        itemLabel={title}
                        onToggle={() => onToggleFavorite(bookmark)}
                      />
                      <BookmarkExternalAction bookmark={bookmark} />
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            )}
          </BookmarkItemWrapper>
        );
      })}
    </Stack>
  );
}

function GridLayout({
  items,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  draggableBookmarks = true,
  sortableBookmarks = false,
  onMoveBookmark,
}: Omit<BookmarkLayoutsProps, 'layoutMode'>) {
  return (
    <Box
      data-testid="library-layout-grid"
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(3, minmax(0, 1fr))',
        },
        gap: 2,
      }}
    >
      {items.map((bookmark, index) => {
        const title = resolveBookmarkTitle(bookmark);
        const sourceLabel = resolveBookmarkSourceLabel(bookmark);
        const checked = Boolean(selectedBookmarkIds[bookmark.id]);

        return (
          <BookmarkItemWrapper
            key={bookmark.id}
            bookmark={bookmark}
            title={title}
            sortable={sortableBookmarks}
            draggable={draggableBookmarks}
          >
            {(bindings) => (
              <Card
                ref={bindings.setNodeRef}
                variant="outlined"
                data-testid={`bookmark-item-${bookmark.id}`}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  transform: bindings.transformStyle,
                  transition: bindings.transitionStyle,
                  opacity: bindings.isDragging ? 0.5 : 1,
                }}
              >
                <CardContent
                  sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1.25 }}
                >
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                      <Checkbox
                        size="small"
                        checked={checked}
                        onChange={() => onToggleSelect(bookmark.id)}
                        slotProps={{
                          input: {
                            'aria-label': `${SHARED_BOOKMARK_STRINGS.selectBookmarkLabel}: ${title}`,
                          },
                        }}
                        sx={{ p: 0.25 }}
                      />
                      <BookmarkIconBadge
                        iconRef={bookmark.iconRef}
                        contentType={bookmark.contentType}
                        alt={title}
                        size={32}
                      />
                    </Stack>

                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                      <BookmarkDragAndOrderControls
                        bookmark={bookmark}
                        title={title}
                        dragHandle={bindings.dragHandle}
                        draggable={draggableBookmarks}
                        sortable={sortableBookmarks}
                        index={index}
                        total={items.length}
                        onMoveBookmark={onMoveBookmark}
                      />
                      <FavoriteToggleButton
                        favorite={bookmark.favorite}
                        itemLabel={title}
                        onToggle={() => onToggleFavorite(bookmark)}
                      />
                      <BookmarkExternalAction bookmark={bookmark} />
                    </Stack>
                  </Stack>

                  <Link
                    component={RouterLink}
                    to={`/bookmarks/${bookmark.id}`}
                    underline="hover"
                    color="text.primary"
                    variant="subtitle1"
                    sx={{ fontWeight: 600 }}
                  >
                    {title}
                  </Link>

                  {sourceLabel ? (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {sourceLabel}
                    </Typography>
                  ) : null}

                  {bookmark.excerpt ? (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        flexGrow: 1,
                      }}
                    >
                      {bookmark.excerpt}
                    </Typography>
                  ) : (
                    <Box sx={{ flexGrow: 1 }} />
                  )}

                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
                  >
                    <ContentTypeChip contentType={bookmark.contentType} />
                    <TagChipList tags={bookmark.tags} maxVisible={3} />
                  </Stack>
                </CardContent>
              </Card>
            )}
          </BookmarkItemWrapper>
        );
      })}
    </Box>
  );
}

function HeadlinesLayout({
  items,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  draggableBookmarks = true,
  sortableBookmarks = false,
  onMoveBookmark,
}: Omit<BookmarkLayoutsProps, 'layoutMode'>) {
  return (
    <Paper variant="outlined" data-testid="library-layout-headlines">
      <List dense disablePadding>
        {items.map((bookmark, index) => {
          const title = resolveBookmarkTitle(bookmark);
          const sourceLabel = resolveBookmarkSourceLabel(bookmark);
          const checked = Boolean(selectedBookmarkIds[bookmark.id]);

          return (
            <BookmarkItemWrapper
              key={bookmark.id}
              bookmark={bookmark}
              title={title}
              sortable={sortableBookmarks}
              draggable={draggableBookmarks}
            >
              {(bindings) => (
                <Box
                  ref={bindings.setNodeRef}
                  data-testid={`bookmark-item-${bookmark.id}`}
                  sx={{
                    transform: bindings.transformStyle,
                    transition: bindings.transitionStyle,
                    opacity: bindings.isDragging ? 0.5 : 1,
                  }}
                >
                  {index > 0 ? <Divider /> : null}
                  <ListItem sx={{ py: 1, px: 2, gap: 1.5, display: 'flex', alignItems: 'center' }}>
                    <Checkbox
                      size="small"
                      checked={checked}
                      onChange={() => onToggleSelect(bookmark.id)}
                      slotProps={{
                        input: {
                          'aria-label': `${SHARED_BOOKMARK_STRINGS.selectBookmarkLabel}: ${title}`,
                        },
                      }}
                      sx={{ p: 0.25 }}
                    />

                    <BookmarkIconBadge
                      iconRef={bookmark.iconRef}
                      contentType={bookmark.contentType}
                      alt={title}
                      size={24}
                    />

                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={{ xs: 0.25, sm: 1.5 }}
                        sx={{ alignItems: { sm: 'baseline' }, minWidth: 0 }}
                      >
                        <Link
                          component={RouterLink}
                          to={`/bookmarks/${bookmark.id}`}
                          underline="hover"
                          color="text.primary"
                          variant="body2"
                          noWrap
                          sx={{ fontWeight: 600 }}
                        >
                          {title}
                        </Link>
                        {sourceLabel ? (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {sourceLabel}
                          </Typography>
                        ) : null}
                      </Stack>
                    </Box>

                    <Stack
                      direction="row"
                      spacing={0.75}
                      sx={{ alignItems: 'center', flexShrink: 0 }}
                    >
                      <Box sx={{ display: { xs: 'none', md: 'inline-flex' } }}>
                        <ContentTypeChip contentType={bookmark.contentType} />
                      </Box>
                      <BookmarkDragAndOrderControls
                        bookmark={bookmark}
                        title={title}
                        dragHandle={bindings.dragHandle}
                        draggable={draggableBookmarks}
                        sortable={sortableBookmarks}
                        index={index}
                        total={items.length}
                        onMoveBookmark={onMoveBookmark}
                      />
                      <FavoriteToggleButton
                        favorite={bookmark.favorite}
                        itemLabel={title}
                        onToggle={() => onToggleFavorite(bookmark)}
                      />
                      <BookmarkExternalAction bookmark={bookmark} />
                    </Stack>
                  </ListItem>
                </Box>
              )}
            </BookmarkItemWrapper>
          );
        })}
      </List>
    </Paper>
  );
}

function MoodboardLayout({
  items,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  draggableBookmarks = true,
  sortableBookmarks = false,
  onMoveBookmark,
}: Omit<BookmarkLayoutsProps, 'layoutMode'>) {
  return (
    <Box
      data-testid="library-layout-moodboard"
      sx={{
        columnCount: { xs: 1, sm: 2, lg: 3 },
        columnGap: 2,
      }}
    >
      {items.map((bookmark, index) => {
        const title = resolveBookmarkTitle(bookmark);
        const sourceLabel = resolveBookmarkSourceLabel(bookmark);
        const checked = Boolean(selectedBookmarkIds[bookmark.id]);

        return (
          <BookmarkItemWrapper
            key={bookmark.id}
            bookmark={bookmark}
            title={title}
            sortable={sortableBookmarks}
            draggable={draggableBookmarks}
          >
            {(bindings) => (
              <Card
                ref={bindings.setNodeRef}
                variant="outlined"
                data-testid={`bookmark-item-${bookmark.id}`}
                sx={{
                  breakInside: 'avoid',
                  mb: 2,
                  display: 'inline-block',
                  width: '100%',
                  transform: bindings.transformStyle,
                  transition: bindings.transitionStyle,
                  opacity: bindings.isDragging ? 0.5 : 1,
                }}
              >
                <Box
                  sx={{
                    px: 2,
                    py: 1.5,
                    bgcolor: 'action.hover',
                    borderBottom: 1,
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
                    <Checkbox
                      size="small"
                      checked={checked}
                      onChange={() => onToggleSelect(bookmark.id)}
                      slotProps={{
                        input: {
                          'aria-label': `${SHARED_BOOKMARK_STRINGS.selectBookmarkLabel}: ${title}`,
                        },
                      }}
                      sx={{ p: 0.25 }}
                    />
                    <BookmarkIconBadge
                      iconRef={bookmark.iconRef}
                      contentType={bookmark.contentType}
                      alt={title}
                      size={36}
                    />
                    {sourceLabel ? (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {sourceLabel}
                      </Typography>
                    ) : null}
                  </Stack>

                  <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
                    <BookmarkDragAndOrderControls
                      bookmark={bookmark}
                      title={title}
                      dragHandle={bindings.dragHandle}
                      draggable={draggableBookmarks}
                      sortable={sortableBookmarks}
                      index={index}
                      total={items.length}
                      onMoveBookmark={onMoveBookmark}
                    />
                    <FavoriteToggleButton
                      favorite={bookmark.favorite}
                      itemLabel={title}
                      onToggle={() => onToggleFavorite(bookmark)}
                    />
                    <BookmarkExternalAction bookmark={bookmark} />
                  </Stack>
                </Box>

                <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                  <Link
                    component={RouterLink}
                    to={`/bookmarks/${bookmark.id}`}
                    underline="hover"
                    color="text.primary"
                    variant="subtitle1"
                    sx={{ fontWeight: 600 }}
                  >
                    {title}
                  </Link>

                  {bookmark.excerpt ? (
                    <Typography variant="body2" color="text.secondary">
                      {bookmark.excerpt}
                    </Typography>
                  ) : null}

                  {bookmark.note ? (
                    <Paper variant="outlined" sx={{ p: 1.25, bgcolor: 'background.default' }}>
                      <Typography variant="caption" color="text.secondary">
                        {bookmark.note}
                      </Typography>
                    </Paper>
                  ) : null}

                  <Stack
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
                  >
                    <ContentTypeChip contentType={bookmark.contentType} />
                    <TagChipList tags={bookmark.tags} />
                  </Stack>
                </CardContent>
              </Card>
            )}
          </BookmarkItemWrapper>
        );
      })}
    </Box>
  );
}

export function BookmarkLayouts({
  items,
  layoutMode,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  draggableBookmarks = true,
  sortableBookmarks = false,
  onMoveBookmark,
}: BookmarkLayoutsProps) {
  const layoutNode = (() => {
    switch (layoutMode) {
      case 'grid':
        return (
          <GridLayout
            items={items}
            selectedBookmarkIds={selectedBookmarkIds}
            onToggleFavorite={onToggleFavorite}
            onToggleSelect={onToggleSelect}
            draggableBookmarks={draggableBookmarks}
            sortableBookmarks={sortableBookmarks}
            onMoveBookmark={onMoveBookmark}
          />
        );
      case 'headlines':
        return (
          <HeadlinesLayout
            items={items}
            selectedBookmarkIds={selectedBookmarkIds}
            onToggleFavorite={onToggleFavorite}
            onToggleSelect={onToggleSelect}
            draggableBookmarks={draggableBookmarks}
            sortableBookmarks={sortableBookmarks}
            onMoveBookmark={onMoveBookmark}
          />
        );
      case 'moodboard':
        return (
          <MoodboardLayout
            items={items}
            selectedBookmarkIds={selectedBookmarkIds}
            onToggleFavorite={onToggleFavorite}
            onToggleSelect={onToggleSelect}
            draggableBookmarks={draggableBookmarks}
            sortableBookmarks={sortableBookmarks}
            onMoveBookmark={onMoveBookmark}
          />
        );
      case 'list':
      default:
        return (
          <ListLayout
            items={items}
            selectedBookmarkIds={selectedBookmarkIds}
            onToggleFavorite={onToggleFavorite}
            onToggleSelect={onToggleSelect}
            draggableBookmarks={draggableBookmarks}
            sortableBookmarks={sortableBookmarks}
            onMoveBookmark={onMoveBookmark}
          />
        );
    }
  })();

  if (!sortableBookmarks) {
    return layoutNode;
  }

  const strategy = layoutMode === 'grid' ? rectSortingStrategy : verticalListSortingStrategy;
  return (
    <SortableContext items={items.map((item) => buildBookmarkDragId(item.id))} strategy={strategy}>
      {layoutNode}
    </SortableContext>
  );
}
