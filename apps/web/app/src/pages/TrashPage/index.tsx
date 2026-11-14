import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import RestoreFromTrashOutlinedIcon from '@mui/icons-material/RestoreFromTrashOutlined';
import { selectAllMatchingBookmarksAction } from '../../shared/actions/bulkActions';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { useBookmarkDetailNavigationState } from '../../shared/hooks/useBookmarkDetailNavigationState';
import { AuthenticatedFilePreview } from '../../shared/components/AuthenticatedFilePreview';
import { BookmarkIconBadge } from '../../shared/components/BookmarkIconBadge';
import { BulkActionToolbar } from '../../shared/components/BulkActionToolbar';
import { ContentTypeChip } from '../../shared/components/ContentTypeChip';
import { TagChipList } from '../../shared/components/TagChipList';
import { SHARED_BOOKMARK_STRINGS } from '../../shared/strings';
import { formatBookmarkFileMeta, isImageFileBookmark } from '../../shared/utils/fileFormat';
import { useTrashView } from './hooks/useTrashView';
import { TRASH_PAGE_STRINGS } from './strings';

export default function TrashPage() {
  const detailLinkState = useBookmarkDetailNavigationState();
  const {
    items,
    totalCount,
    hasMore,
    loading,
    loadingMore,
    busyItemId,
    purgingAll,
    error,
    retentionDays,
    retentionFromSettings,
    selectedBookmarkIds,
    toggleBookmarkSelection,
    loadMore,
    retry,
    restoreItem,
    purgeItem,
    purgeAll,
    refresh,
  } = useTrashView();

  const [purgeAllDialogOpen, setPurgeAllDialogOpen] = useState(false);

  const visibleBookmarkIds = useMemo(() => items.map((item) => item.id), [items]);

  const countLabel =
    totalCount === 1
      ? TRASH_PAGE_STRINGS.countSingular
      : `${totalCount} ${TRASH_PAGE_STRINGS.countPluralSuffix}`;

  const handleConfirmPurgeAll = async () => {
    await purgeAll();
    setPurgeAllDialogOpen(false);
  };

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
      >
        <Box>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Typography variant="h4" component="h1">
              {TRASH_PAGE_STRINGS.title}
            </Typography>
            <Chip size="small" label={countLabel} variant="outlined" />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {TRASH_PAGE_STRINGS.subtitle}
          </Typography>
        </Box>

        <Button
          variant="outlined"
          color="error"
          startIcon={<DeleteForeverOutlinedIcon fontSize="small" />}
          disabled={loading || purgingAll || items.length === 0}
          onClick={() => setPurgeAllDialogOpen(true)}
        >
          {TRASH_PAGE_STRINGS.purgeAllLabel}
        </Button>
      </Stack>

      <Alert severity="info" data-testid="trash-retention-note">
        {`${TRASH_PAGE_STRINGS.retentionPolicyPrefix} ${retentionDays} ${TRASH_PAGE_STRINGS.retentionPolicySuffix} ${
          retentionFromSettings
            ? TRASH_PAGE_STRINGS.retentionAdminNoteSuffix
            : TRASH_PAGE_STRINGS.retentionDefaultNoteSuffix
        }`}
      </Alert>

      <BulkActionToolbar
        visibleBookmarkIds={visibleBookmarkIds}
        context="trash"
        totalCount={totalCount}
        onSelectAllMatching={() => selectAllMatchingBookmarksAction({ trashed: true, page: 1 })}
        onActionCompleted={() => {
          refresh();
        }}
      />

      {error ? (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={retry}>
              {TRASH_PAGE_STRINGS.errorRetryLabel}
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <Stack spacing={1.5} data-testid="trash-loading">
          <Skeleton variant="rounded" height={88} />
          <Skeleton variant="rounded" height={88} />
        </Stack>
      ) : items.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6">{TRASH_PAGE_STRINGS.emptyTitle}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {TRASH_PAGE_STRINGS.emptyDescription}
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5} data-testid="trash-list">
          {items.map((bookmark) => {
            const title =
              bookmark.title ??
              bookmark.fileName ??
              bookmark.url ??
              SHARED_BOOKMARK_STRINGS.untitledBookmark;
            const sourceLabel =
              bookmark.storageKind === 'file'
                ? (formatBookmarkFileMeta(bookmark) ??
                  bookmark.fileName ??
                  SHARED_BOOKMARK_STRINGS.fileItemLabel)
                : (bookmark.urlParts?.host ?? bookmark.url ?? '');
            const checked = Boolean(selectedBookmarkIds[bookmark.id]);
            const isItemBusy = busyItemId === bookmark.id || purgingAll;

            return (
              <Card key={bookmark.id} variant="outlined" data-testid={`trash-item-${bookmark.id}`}>
                <CardContent sx={{ py: 1.75, '&:last-child': { pb: 1.75 } }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
                  >
                    <Stack
                      direction="row"
                      spacing={1.5}
                      sx={{ alignItems: 'flex-start', minWidth: 0, flexGrow: 1 }}
                    >
                      <Checkbox
                        size="small"
                        checked={checked}
                        disabled={isItemBusy}
                        onChange={() => toggleBookmarkSelection(bookmark.id)}
                        slotProps={{
                          input: {
                            'aria-label': `${SHARED_BOOKMARK_STRINGS.selectBookmarkLabel}: ${title}`,
                          },
                        }}
                        sx={{ mt: -0.5 }}
                      />

                      {isImageFileBookmark(bookmark) ? (
                        <AuthenticatedFilePreview
                          bookmarkId={bookmark.id}
                          contentType={bookmark.contentType}
                          alt={title}
                          size={44}
                        />
                      ) : (
                        <BookmarkIconBadge
                          iconRef={bookmark.iconRef}
                          contentType={bookmark.contentType}
                          alt={title}
                        />
                      )}

                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
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
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ mt: 1, alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
                        >
                          <ContentTypeChip contentType={bookmark.contentType} />
                          {bookmark.deletedAt ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={`${TRASH_PAGE_STRINGS.trashedAtPrefix}: ${new Date(
                                bookmark.deletedAt,
                              ).toLocaleDateString()}`}
                            />
                          ) : null}
                          <TagChipList tags={bookmark.tags} maxVisible={4} />
                        </Stack>
                      </Box>
                    </Stack>

                    <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<RestoreFromTrashOutlinedIcon fontSize="small" />}
                        disabled={isItemBusy}
                        aria-label={`${TRASH_PAGE_STRINGS.restoreItemLabel}: ${title}`}
                        onClick={() => void restoreItem(bookmark.id)}
                      >
                        {TRASH_PAGE_STRINGS.restoreItemLabel}
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        startIcon={<DeleteForeverOutlinedIcon fontSize="small" />}
                        disabled={isItemBusy}
                        aria-label={`${TRASH_PAGE_STRINGS.purgeItemLabel}: ${title}`}
                        onClick={() => void purgeItem(bookmark.id)}
                      >
                        {TRASH_PAGE_STRINGS.purgeItemLabel}
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}

          {hasMore ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
              <Button variant="outlined" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore
                  ? TRASH_PAGE_STRINGS.loadingMoreLabel
                  : TRASH_PAGE_STRINGS.loadMoreLabel}
              </Button>
            </Box>
          ) : null}
        </Stack>
      )}

      <Dialog
        open={purgeAllDialogOpen}
        onClose={() => (!purgingAll ? setPurgeAllDialogOpen(false) : undefined)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{TRASH_PAGE_STRINGS.purgeAllConfirmTitle}</DialogTitle>
        <DialogContent>
          <DialogContentText>{TRASH_PAGE_STRINGS.purgeAllConfirmBody}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={purgingAll} onClick={() => setPurgeAllDialogOpen(false)}>
            {TRASH_PAGE_STRINGS.purgeAllCancel}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={purgingAll}
            onClick={() => void handleConfirmPurgeAll()}
          >
            {TRASH_PAGE_STRINGS.purgeAllConfirmSubmit}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
