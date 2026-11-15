import ArrowDownwardOutlinedIcon from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlinedIcon from '@mui/icons-material/ArrowUpwardOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
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
import Chip from '@mui/material/Chip';
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
import { memo } from 'react';
import { Link as RouterLink } from 'react-router';
import { Virtuoso } from 'react-virtuoso';
import type { Bookmark } from '../../api/schemas/bookmarks';
import { bookmarksApi } from '../../api/endpoints/bookmarks';
import type { LibraryLayoutMode } from '../../stores/libraryStore';
import { downloadBookmarkFileAction } from '../actions/bookmarkActions';
import { buildBookmarkDragId, type DragItemData } from '../hooks/useAppDnd';
import { useBookmarkDetailNavigationState } from '../hooks/useBookmarkDetailNavigationState';
import { SHARED_BOOKMARK_STRINGS } from '../strings';
import {
  formatBookmarkFileMeta,
  isExtractableTextFileBookmark,
  isImageFileBookmark,
} from '../utils/fileFormat';
import { AuthenticatedFilePreview } from './AuthenticatedFilePreview';
import { BookmarkIconBadge } from './BookmarkIconBadge';
import { ContentTypeChip } from './ContentTypeChip';
import { FavoriteToggleButton } from './FavoriteToggleButton';
import { ReminderBadge } from './ReminderBadge';
import { TagChipList } from './TagChipList';

/**
 * Lists longer than this switch to window-scroll virtualization (react-virtuoso)
 * so the DOM node count stays constant as "Load more" grows the view. Short
 * lists stay on the plain path, which is also what the test suite exercises.
 */
const VIRTUALIZE_ITEM_THRESHOLD = 120;

/** Stable-prop contract shared by the memoized rows of every layout. */
interface BookmarkRowProps {
  bookmark: Bookmark;
  checked: boolean;
  detailLinkState: ReturnType<typeof useBookmarkDetailNavigationState>;
  index: number;
  total: number;
  draggable: boolean;
  sortable: boolean;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onToggleSelect: (id: string) => void;
  onMoveBookmark?: (bookmarkId: string, direction: 'up' | 'down') => void;
  onTagClick?: (tagName: string) => void;
}

export interface BookmarkLayoutsProps {
  items: Bookmark[];
  layoutMode: LibraryLayoutMode;
  selectedBookmarkIds: Record<string, true>;
  onToggleFavorite: (bookmark: Bookmark) => void;
  onToggleSelect: (id: string) => void;
  onTagClick?: (tagName: string) => void;
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

/** Memoized SortableContext id list — one array identity per items identity. */
const sortableDragIdsCache = new WeakMap<Bookmark[], string[]>();
function sortableDragIds(items: Bookmark[]): string[] {
  const cached = sortableDragIdsCache.get(items);
  if (cached) return cached;
  const ids = items.map((item) => buildBookmarkDragId(item.id));
  sortableDragIdsCache.set(items, ids);
  return ids;
}

function resolveBookmarkSourceLabel(bookmark: Bookmark): string {
  if (bookmark.storageKind === 'file') {
    return (
      formatBookmarkFileMeta(bookmark) ?? bookmark.fileName ?? SHARED_BOOKMARK_STRINGS.fileItemLabel
    );
  }
  return bookmark.urlParts?.host ?? bookmark.url ?? '';
}

function BookmarkPrimaryAction({ bookmark }: { bookmark: Bookmark }) {
  const title = resolveBookmarkTitle(bookmark);

  if (bookmark.storageKind === 'file') {
    return (
      <Tooltip title={SHARED_BOOKMARK_STRINGS.downloadFileLabel}>
        <IconButton
          size="small"
          aria-label={`${SHARED_BOOKMARK_STRINGS.downloadFileLabel}: ${title}`}
          onClick={() => void downloadBookmarkFileAction(bookmark).catch(() => undefined)}
        >
          <DownloadOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  if (!bookmark.url) return null;
  return (
    <Tooltip title={bookmark.url}>
      <IconButton
        component="a"
        href={bookmark.url}
        target="_blank"
        rel="noopener noreferrer"
        size="small"
        aria-label={`Open external URL for ${title}`}
      >
        <OpenInNewOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function ArchiveTextChipLink({ bookmark }: { bookmark: Bookmark }) {
  const detailLinkState = useBookmarkDetailNavigationState();
  if (!isExtractableTextFileBookmark(bookmark)) return null;
  return (
    <Chip
      component={RouterLink}
      to={`/bookmarks/${bookmark.id}?tab=archive&view=text`}
      state={detailLinkState}
      clickable
      size="small"
      variant="outlined"
      icon={<DescriptionOutlinedIcon fontSize="small" />}
      label={SHARED_BOOKMARK_STRINGS.viewArchiveTextLabel}
    />
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

/**
 * Memoized so an unchanged bookmark (the store keeps object identity for
 * untouched entries) skips re-rendering entirely when a sync frame or an
 * unrelated store update re-renders the page.
 */
const ListRow = memo(function ListRow({
  bookmark,
  checked,
  detailLinkState,
  index,
  total,
  draggable,
  sortable,
  onToggleFavorite,
  onToggleSelect,
  onMoveBookmark,
  onTagClick,
}: BookmarkRowProps) {
  const title = resolveBookmarkTitle(bookmark);
  const sourceLabel = resolveBookmarkSourceLabel(bookmark);
  const isImageFile = isImageFileBookmark(bookmark);

  return (
    <BookmarkItemWrapper
      bookmark={bookmark}
      title={title}
      sortable={sortable}
      draggable={draggable}
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

              {isImageFile ? (
                <AuthenticatedFilePreview
                  bookmarkId={bookmark.id}
                  contentType={bookmark.contentType}
                  alt={title}
                  size={48}
                />
              ) : (
                <BookmarkIconBadge
                  iconRef={bookmark.iconRef}
                  contentType={bookmark.contentType}
                  alt={title}
                />
              )}

              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Link
                  component={RouterLink}
                  to={`/bookmarks/${bookmark.id}`}
                  state={detailLinkState}
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
                  <ContentTypeChip contentType={bookmark.contentType} borderless />
                  <ArchiveTextChipLink bookmark={bookmark} />
                  <ReminderBadge
                    reminderAt={bookmark.reminderAt}
                    remindedAt={bookmark.remindedAt}
                  />
                  <TagChipList tags={bookmark.tags} maxVisible={5} onTagClick={onTagClick} />
                </Stack>
              </Box>

              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexShrink: 0 }}>
                <BookmarkDragAndOrderControls
                  bookmark={bookmark}
                  title={title}
                  dragHandle={bindings.dragHandle}
                  draggable={draggable}
                  sortable={sortable}
                  index={index}
                  total={total}
                  onMoveBookmark={onMoveBookmark}
                />
                <FavoriteToggleButton
                  favorite={bookmark.favorite}
                  itemLabel={title}
                  onToggle={() => onToggleFavorite(bookmark)}
                />
                <BookmarkPrimaryAction bookmark={bookmark} />
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}
    </BookmarkItemWrapper>
  );
});

function ListLayout({
  items,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  onTagClick,
  draggableBookmarks = true,
  sortableBookmarks = false,
  onMoveBookmark,
}: Omit<BookmarkLayoutsProps, 'layoutMode'>) {
  const detailLinkState = useBookmarkDetailNavigationState();
  const total = items.length;

  if (total > VIRTUALIZE_ITEM_THRESHOLD) {
    return (
      <Box data-testid="library-layout-list">
        <Virtuoso
          useWindowScroll
          totalCount={total}
          itemContent={(index) => {
            const bookmark = items[index];
            if (!bookmark) return null;
            return (
              <Box sx={{ pb: 1.5 }}>
                <ListRow
                  bookmark={bookmark}
                  checked={Boolean(selectedBookmarkIds[bookmark.id])}
                  detailLinkState={detailLinkState}
                  index={index}
                  total={total}
                  draggable={draggableBookmarks}
                  sortable={sortableBookmarks}
                  onToggleFavorite={onToggleFavorite}
                  onToggleSelect={onToggleSelect}
                  onMoveBookmark={onMoveBookmark}
                  onTagClick={onTagClick}
                />
              </Box>
            );
          }}
        />
      </Box>
    );
  }

  return (
    <Stack spacing={1.5} data-testid="library-layout-list">
      {items.map((bookmark, index) => (
        <ListRow
          key={bookmark.id}
          bookmark={bookmark}
          checked={Boolean(selectedBookmarkIds[bookmark.id])}
          detailLinkState={detailLinkState}
          index={index}
          total={total}
          draggable={draggableBookmarks}
          sortable={sortableBookmarks}
          onToggleFavorite={onToggleFavorite}
          onToggleSelect={onToggleSelect}
          onMoveBookmark={onMoveBookmark}
          onTagClick={onTagClick}
        />
      ))}
    </Stack>
  );
}

const GridCard = memo(function GridCard({
  bookmark,
  checked,
  detailLinkState,
  index,
  total,
  draggable,
  sortable,
  onToggleFavorite,
  onToggleSelect,
  onMoveBookmark,
  onTagClick,
}: BookmarkRowProps) {
  const title = resolveBookmarkTitle(bookmark);
  const sourceLabel = resolveBookmarkSourceLabel(bookmark);
  const isImageFile = isImageFileBookmark(bookmark);

  return (
    <BookmarkItemWrapper
      bookmark={bookmark}
      title={title}
      sortable={sortable}
      draggable={draggable}
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
          <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
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
                  draggable={draggable}
                  sortable={sortable}
                  index={index}
                  total={total}
                  onMoveBookmark={onMoveBookmark}
                />
                <FavoriteToggleButton
                  favorite={bookmark.favorite}
                  itemLabel={title}
                  onToggle={() => onToggleFavorite(bookmark)}
                />
                <BookmarkPrimaryAction bookmark={bookmark} />
              </Stack>
            </Stack>

            {isImageFile ? (
              <AuthenticatedFilePreview
                bookmarkId={bookmark.id}
                contentType={bookmark.contentType}
                alt={title}
                variant="banner"
                maxHeight={140}
              />
            ) : bookmark.coverRef ? (
              <Box
                component="img"
                src={bookmarksApi.coverUrl(bookmark.coverRef)}
                alt=""
                loading="lazy"
                sx={{
                  width: '100%',
                  height: 140,
                  objectFit: 'cover',
                  borderRadius: 1,
                  display: 'block',
                }}
                data-testid={`bookmark-cover-${bookmark.id}`}
              />
            ) : null}

            <Link
              component={RouterLink}
              to={`/bookmarks/${bookmark.id}`}
              state={detailLinkState}
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
              <ContentTypeChip contentType={bookmark.contentType} borderless />
              <ArchiveTextChipLink bookmark={bookmark} />
              <ReminderBadge reminderAt={bookmark.reminderAt} remindedAt={bookmark.remindedAt} />
              <TagChipList tags={bookmark.tags} maxVisible={3} onTagClick={onTagClick} />
            </Stack>
          </CardContent>
        </Card>
      )}
    </BookmarkItemWrapper>
  );
});

function GridLayout({
  items,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  onTagClick,
  draggableBookmarks = true,
  sortableBookmarks = false,
  onMoveBookmark,
}: Omit<BookmarkLayoutsProps, 'layoutMode'>) {
  const detailLinkState = useBookmarkDetailNavigationState();
  const total = items.length;
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
      {items.map((bookmark, index) => (
        <GridCard
          key={bookmark.id}
          bookmark={bookmark}
          checked={Boolean(selectedBookmarkIds[bookmark.id])}
          detailLinkState={detailLinkState}
          index={index}
          total={total}
          draggable={draggableBookmarks}
          sortable={sortableBookmarks}
          onToggleFavorite={onToggleFavorite}
          onToggleSelect={onToggleSelect}
          onMoveBookmark={onMoveBookmark}
          onTagClick={onTagClick}
        />
      ))}
    </Box>
  );
}

const HeadlineRow = memo(function HeadlineRow({
  bookmark,
  checked,
  detailLinkState,
  index,
  total,
  draggable,
  sortable,
  onToggleFavorite,
  onToggleSelect,
  onMoveBookmark,
}: BookmarkRowProps) {
  const title = resolveBookmarkTitle(bookmark);
  const sourceLabel = resolveBookmarkSourceLabel(bookmark);
  const isImageFile = isImageFileBookmark(bookmark);

  return (
    <BookmarkItemWrapper
      bookmark={bookmark}
      title={title}
      sortable={sortable}
      draggable={draggable}
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

            {isImageFile ? (
              <AuthenticatedFilePreview
                bookmarkId={bookmark.id}
                contentType={bookmark.contentType}
                alt={title}
                size={24}
              />
            ) : (
              <BookmarkIconBadge
                iconRef={bookmark.iconRef}
                contentType={bookmark.contentType}
                alt={title}
                size={24}
              />
            )}

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 0.25, sm: 1.5 }}
                sx={{ alignItems: { sm: 'baseline' }, minWidth: 0 }}
              >
                <Link
                  component={RouterLink}
                  to={`/bookmarks/${bookmark.id}`}
                  state={detailLinkState}
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

            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
              <Box sx={{ display: { xs: 'none', md: 'inline-flex' }, gap: 0.75 }}>
                <ArchiveTextChipLink bookmark={bookmark} />
                <ReminderBadge reminderAt={bookmark.reminderAt} remindedAt={bookmark.remindedAt} />
                <ContentTypeChip contentType={bookmark.contentType} borderless />
              </Box>
              <BookmarkDragAndOrderControls
                bookmark={bookmark}
                title={title}
                dragHandle={bindings.dragHandle}
                draggable={draggable}
                sortable={sortable}
                index={index}
                total={total}
                onMoveBookmark={onMoveBookmark}
              />
              <FavoriteToggleButton
                favorite={bookmark.favorite}
                itemLabel={title}
                onToggle={() => onToggleFavorite(bookmark)}
              />
              <BookmarkPrimaryAction bookmark={bookmark} />
            </Stack>
          </ListItem>
        </Box>
      )}
    </BookmarkItemWrapper>
  );
});

function HeadlinesLayout({
  items,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  draggableBookmarks = true,
  sortableBookmarks = false,
  onMoveBookmark,
}: Omit<BookmarkLayoutsProps, 'layoutMode'>) {
  const detailLinkState = useBookmarkDetailNavigationState();
  const total = items.length;

  if (total > VIRTUALIZE_ITEM_THRESHOLD) {
    return (
      <Paper variant="outlined" data-testid="library-layout-headlines">
        <Virtuoso
          useWindowScroll
          totalCount={total}
          itemContent={(index) => {
            const bookmark = items[index];
            if (!bookmark) return null;
            return (
              <HeadlineRow
                bookmark={bookmark}
                checked={Boolean(selectedBookmarkIds[bookmark.id])}
                detailLinkState={detailLinkState}
                index={index}
                total={total}
                draggable={draggableBookmarks}
                sortable={sortableBookmarks}
                onToggleFavorite={onToggleFavorite}
                onToggleSelect={onToggleSelect}
                onMoveBookmark={onMoveBookmark}
              />
            );
          }}
        />
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" data-testid="library-layout-headlines">
      <List dense disablePadding>
        {items.map((bookmark, index) => (
          <HeadlineRow
            key={bookmark.id}
            bookmark={bookmark}
            checked={Boolean(selectedBookmarkIds[bookmark.id])}
            detailLinkState={detailLinkState}
            index={index}
            total={total}
            draggable={draggableBookmarks}
            sortable={sortableBookmarks}
            onToggleFavorite={onToggleFavorite}
            onToggleSelect={onToggleSelect}
            onMoveBookmark={onMoveBookmark}
          />
        ))}
      </List>
    </Paper>
  );
}

const MoodboardCard = memo(function MoodboardCard({
  bookmark,
  checked,
  detailLinkState,
  index,
  total,
  draggable,
  sortable,
  onToggleFavorite,
  onToggleSelect,
  onMoveBookmark,
  onTagClick,
}: BookmarkRowProps) {
  const title = resolveBookmarkTitle(bookmark);
  const sourceLabel = resolveBookmarkSourceLabel(bookmark);
  const isImageFile = isImageFileBookmark(bookmark);

  return (
    <BookmarkItemWrapper
      bookmark={bookmark}
      title={title}
      sortable={sortable}
      draggable={draggable}
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
                draggable={draggable}
                sortable={sortable}
                index={index}
                total={total}
                onMoveBookmark={onMoveBookmark}
              />
              <FavoriteToggleButton
                favorite={bookmark.favorite}
                itemLabel={title}
                onToggle={() => onToggleFavorite(bookmark)}
              />
              <BookmarkPrimaryAction bookmark={bookmark} />
            </Stack>
          </Box>

          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {isImageFile ? (
              <AuthenticatedFilePreview
                bookmarkId={bookmark.id}
                contentType={bookmark.contentType}
                alt={title}
                variant="banner"
                maxHeight={180}
              />
            ) : bookmark.coverRef ? (
              <Box
                component="img"
                src={bookmarksApi.coverUrl(bookmark.coverRef)}
                alt=""
                loading="lazy"
                sx={{
                  width: '100%',
                  height: 160,
                  objectFit: 'cover',
                  borderRadius: 1,
                  display: 'block',
                }}
                data-testid={`bookmark-cover-${bookmark.id}`}
              />
            ) : null}

            <Link
              component={RouterLink}
              to={`/bookmarks/${bookmark.id}`}
              state={detailLinkState}
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
              <ArchiveTextChipLink bookmark={bookmark} />
              <ReminderBadge reminderAt={bookmark.reminderAt} remindedAt={bookmark.remindedAt} />
              <TagChipList tags={bookmark.tags} onTagClick={onTagClick} />
            </Stack>
          </CardContent>
        </Card>
      )}
    </BookmarkItemWrapper>
  );
});

function MoodboardLayout({
  items,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  onTagClick,
  draggableBookmarks = true,
  sortableBookmarks = false,
  onMoveBookmark,
}: Omit<BookmarkLayoutsProps, 'layoutMode'>) {
  const detailLinkState = useBookmarkDetailNavigationState();
  const total = items.length;
  return (
    <Box
      data-testid="library-layout-moodboard"
      sx={{
        columnCount: { xs: 1, sm: 2, lg: 3 },
        columnGap: 2,
      }}
    >
      {items.map((bookmark, index) => (
        <MoodboardCard
          key={bookmark.id}
          bookmark={bookmark}
          checked={Boolean(selectedBookmarkIds[bookmark.id])}
          detailLinkState={detailLinkState}
          index={index}
          total={total}
          draggable={draggableBookmarks}
          sortable={sortableBookmarks}
          onToggleFavorite={onToggleFavorite}
          onToggleSelect={onToggleSelect}
          onMoveBookmark={onMoveBookmark}
          onTagClick={onTagClick}
        />
      ))}
    </Box>
  );
}

export function BookmarkLayouts({
  items,
  layoutMode,
  selectedBookmarkIds,
  onToggleFavorite,
  onToggleSelect,
  onTagClick,
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
            onTagClick={onTagClick}
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
            onTagClick={onTagClick}
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
            onTagClick={onTagClick}
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
    <SortableContext items={sortableDragIds(items)} strategy={strategy}>
      {layoutNode}
    </SortableContext>
  );
}
