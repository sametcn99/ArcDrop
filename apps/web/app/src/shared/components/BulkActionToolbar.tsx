import CloseIcon from '@mui/icons-material/Close';
import DeleteForeverOutlinedIcon from '@mui/icons-material/DeleteForeverOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DriveFileMoveOutlinedIcon from '@mui/icons-material/DriveFileMoveOutlined';
import LabelOffOutlinedIcon from '@mui/icons-material/LabelOffOutlined';
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined';
import RestoreFromTrashOutlinedIcon from '@mui/icons-material/RestoreFromTrashOutlined';
import SelectAllOutlinedIcon from '@mui/icons-material/SelectAllOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormLabel from '@mui/material/FormLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import type {
  BulkBookmarksRequest,
  BulkBookmarksResponse,
  BulkMoveMode,
} from '../../api/schemas/bookmarks';
import type { CollectionNode } from '../../api/schemas/collections';
import { toApiError } from '../../api/schemas/problem';
import { selectSortedCollections, useLibraryStore } from '../../stores/libraryStore';
import {
  executeBulkBookmarksAction,
  formatBulkSummaryMessage,
  MAX_BULK_BOOKMARK_IDS,
} from '../actions/bulkActions';
import { SHARED_BULK_STRINGS } from '../strings';
import { buildCollectionTree } from '../utils/collectionTree';
import { TagAutocompleteInput } from './TagAutocompleteInput';

export interface BulkActionToolbarProps {
  visibleBookmarkIds: string[];
  context?: 'library' | 'trash';
  onActionCompleted?: (response: BulkBookmarksResponse) => void;
}

interface FlattenedCollectionOption {
  id: string;
  title: string;
  depth: number;
}

function flattenWithDepth(nodes: CollectionNode[], depth = 0): FlattenedCollectionOption[] {
  const result: FlattenedCollectionOption[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, title: node.title, depth });
    if (node.children.length > 0) {
      result.push(...flattenWithDepth(node.children, depth + 1));
    }
  }
  return result;
}

export function BulkActionToolbar({
  visibleBookmarkIds,
  context = 'library',
  onActionCompleted,
}: BulkActionToolbarProps) {
  const selectedBookmarkIds = useLibraryStore((s) => s.selectedBookmarkIds);
  const bookmarksById = useLibraryStore((s) => s.bookmarksById);
  const collectionsById = useLibraryStore((s) => s.collectionsById);
  const selectBookmarks = useLibraryStore((s) => s.selectBookmarks);
  const clearSelection = useLibraryStore((s) => s.clearSelection);

  const selectedIds = useMemo(() => Object.keys(selectedBookmarkIds), [selectedBookmarkIds]);
  const selectedCount = selectedIds.length;
  const exceedsMaxCap = selectedCount > MAX_BULK_BOOKMARK_IDS;

  const hasActiveSelected = useMemo(
    () =>
      selectedIds.some((id) => {
        const item = bookmarksById[id];
        return item ? item.deletedAt === null : context === 'library';
      }),
    [bookmarksById, context, selectedIds],
  );

  const hasTrashedSelected = useMemo(
    () =>
      selectedIds.some((id) => {
        const item = bookmarksById[id];
        return item ? item.deletedAt !== null : context === 'trash';
      }),
    [bookmarksById, context, selectedIds],
  );

  const collectionOptions = useMemo(() => {
    const sorted = selectSortedCollections({
      collectionsById,
    } as Parameters<typeof selectSortedCollections>[0]);
    return flattenWithDepth(buildCollectionTree(sorted));
  }, [collectionsById]);

  const [busy, setBusy] = useState(false);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [rateLimitState, setRateLimitState] = useState<{
    detail: string;
    retryAfterSeconds?: number;
    failedRequest: BulkBookmarksRequest;
  } | null>(null);

  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveMode, setMoveMode] = useState<BulkMoveMode>('union');
  const [moveCollectionIds, setMoveCollectionIds] = useState<string[]>([]);
  const [moveValidationError, setMoveValidationError] = useState<string | null>(null);

  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [tagsDialogMode, setTagsDialogMode] = useState<'addTags' | 'removeTags'>('addTags');
  const [tagInputs, setTagInputs] = useState<string[]>([]);
  const [tagsValidationError, setTagsValidationError] = useState<string | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const runBulkRequest = async (request: BulkBookmarksRequest): Promise<boolean> => {
    setBusy(true);
    setInlineError(null);
    setRateLimitState(null);
    try {
      const response = await executeBulkBookmarksAction(request);
      setSummaryMessage(formatBulkSummaryMessage(response));
      onActionCompleted?.(response);
      return true;
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr.status === 429) {
        setRateLimitState({
          detail: apiErr.detail,
          retryAfterSeconds: apiErr.retryAfterSeconds,
          failedRequest: request,
        });
      } else if (apiErr.status === 409 && request.action === 'delete') {
        setInlineError(apiErr.detail || SHARED_BULK_STRINGS.trashedOnlyHint);
      } else {
        setInlineError(apiErr.detail || 'Bulk operation failed.');
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleOpenMove = () => {
    setMoveMode('union');
    setMoveCollectionIds([]);
    setMoveValidationError(null);
    setMoveDialogOpen(true);
  };

  const handleSubmitMove = async () => {
    if (moveMode === 'union' && moveCollectionIds.length === 0) {
      setMoveValidationError(SHARED_BULK_STRINGS.moveUnionRequiresCollection);
      return;
    }
    const ok = await runBulkRequest({
      action: 'move',
      ids: selectedIds,
      mode: moveMode,
      collectionIds: moveCollectionIds,
    });
    if (ok) {
      setMoveDialogOpen(false);
    }
  };

  const handleOpenTags = (mode: 'addTags' | 'removeTags') => {
    setTagsDialogMode(mode);
    setTagInputs([]);
    setTagsValidationError(null);
    setTagsDialogOpen(true);
  };

  const handleSubmitTags = async () => {
    if (tagInputs.length === 0) {
      setTagsValidationError(SHARED_BULK_STRINGS.tagsRequiredError);
      return;
    }
    const ok = await runBulkRequest({
      action: tagsDialogMode,
      ids: selectedIds,
      tags: tagInputs,
    });
    if (ok) {
      setTagsDialogOpen(false);
    }
  };

  const handleConfirmDelete = async () => {
    const ok = await runBulkRequest({
      action: 'delete',
      ids: selectedIds,
    });
    if (ok) {
      setDeleteConfirmOpen(false);
    }
  };

  const handleToggleMoveCollection = (collectionId: string) => {
    setMoveValidationError(null);
    setMoveCollectionIds((prev) =>
      prev.includes(collectionId)
        ? prev.filter((id) => id !== collectionId)
        : [...prev, collectionId],
    );
  };

  if (selectedCount === 0 && !summaryMessage && !inlineError && !rateLimitState) {
    if (visibleBookmarkIds.length === 0) {
      return null;
    }
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          size="small"
          startIcon={<SelectAllOutlinedIcon fontSize="small" />}
          onClick={() => selectBookmarks(visibleBookmarkIds)}
        >
          {SHARED_BULK_STRINGS.selectAllLabel}
        </Button>
      </Box>
    );
  }

  return (
    <Stack spacing={1.5} data-testid="bulk-action-toolbar-root">
      {selectedCount > 0 ? (
        <Paper
          variant="outlined"
          role="region"
          aria-label={SHARED_BULK_STRINGS.toolbarAriaLabel}
          data-testid="bulk-action-toolbar"
          sx={{ p: 1.5, bgcolor: 'background.paper' }}
        >
          <Stack spacing={1.25}>
            {busy ? <LinearProgress aria-label={SHARED_BULK_STRINGS.runningLabel} /> : null}

            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1}
              sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
            >
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
              >
                <Chip
                  size="small"
                  color="primary"
                  label={`${selectedCount} ${
                    selectedCount === 1
                      ? SHARED_BULK_STRINGS.selectedSingular
                      : SHARED_BULK_STRINGS.selectedPlural
                  }`}
                  data-testid="bulk-selected-count"
                />
                {visibleBookmarkIds.length > 0 ? (
                  <Button
                    size="small"
                    startIcon={<SelectAllOutlinedIcon fontSize="small" />}
                    disabled={busy}
                    onClick={() => selectBookmarks(visibleBookmarkIds)}
                  >
                    {SHARED_BULK_STRINGS.selectAllLabel}
                  </Button>
                ) : null}
                <Button
                  size="small"
                  startIcon={<CloseIcon fontSize="small" />}
                  disabled={busy}
                  onClick={() => clearSelection()}
                >
                  {SHARED_BULK_STRINGS.clearSelectionLabel}
                </Button>
              </Stack>

              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}
              >
                {context === 'library' ? (
                  <>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<DriveFileMoveOutlinedIcon fontSize="small" />}
                      disabled={busy || exceedsMaxCap || hasTrashedSelected}
                      onClick={handleOpenMove}
                    >
                      {SHARED_BULK_STRINGS.moveLabel}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<LabelOutlinedIcon fontSize="small" />}
                      disabled={busy || exceedsMaxCap || hasTrashedSelected}
                      onClick={() => handleOpenTags('addTags')}
                    >
                      {SHARED_BULK_STRINGS.addTagsLabel}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<LabelOffOutlinedIcon fontSize="small" />}
                      disabled={busy || exceedsMaxCap || hasTrashedSelected}
                      onClick={() => handleOpenTags('removeTags')}
                    >
                      {SHARED_BULK_STRINGS.removeTagsLabel}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="warning"
                      startIcon={<DeleteOutlineOutlinedIcon fontSize="small" />}
                      disabled={busy || exceedsMaxCap || hasTrashedSelected}
                      onClick={() =>
                        void runBulkRequest({
                          action: 'trash',
                          ids: selectedIds,
                        })
                      }
                    >
                      {SHARED_BULK_STRINGS.trashLabel}
                    </Button>
                  </>
                ) : null}

                {context === 'trash' || hasTrashedSelected ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    startIcon={<RestoreFromTrashOutlinedIcon fontSize="small" />}
                    disabled={busy || exceedsMaxCap || hasActiveSelected}
                    onClick={() =>
                      void runBulkRequest({
                        action: 'restore',
                        ids: selectedIds,
                      })
                    }
                  >
                    {SHARED_BULK_STRINGS.restoreLabel}
                  </Button>
                ) : null}

                <Tooltip
                  title={
                    hasActiveSelected
                      ? SHARED_BULK_STRINGS.trashedOnlyHint
                      : SHARED_BULK_STRINGS.deleteLabel
                  }
                >
                  <Box component="span" sx={{ display: 'inline-flex' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteForeverOutlinedIcon fontSize="small" />}
                      disabled={busy || exceedsMaxCap || hasActiveSelected}
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      {SHARED_BULK_STRINGS.deleteLabel}
                    </Button>
                  </Box>
                </Tooltip>
              </Stack>
            </Stack>

            {hasActiveSelected && context === 'library' ? (
              <Typography
                variant="caption"
                color="text.secondary"
                data-testid="bulk-trashed-only-hint"
              >
                {SHARED_BULK_STRINGS.trashedOnlyHint}
              </Typography>
            ) : null}

            {exceedsMaxCap ? (
              <Alert severity="warning" data-testid="bulk-max-cap-warning">
                {`${SHARED_BULK_STRINGS.maxCapWarningPrefix} (${selectedCount}/${MAX_BULK_BOOKMARK_IDS})`}
              </Alert>
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      {summaryMessage ? (
        <Alert
          severity="success"
          data-testid="bulk-summary-alert"
          action={
            <IconButton
              size="small"
              aria-label={SHARED_BULK_STRINGS.dismissLabel}
              onClick={() => setSummaryMessage(null)}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          }
        >
          {summaryMessage}
        </Alert>
      ) : null}

      {rateLimitState ? (
        <Alert
          severity="warning"
          data-testid="bulk-rate-limit-alert"
          action={
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                color="inherit"
                disabled={busy}
                onClick={() => void runBulkRequest(rateLimitState.failedRequest)}
              >
                {SHARED_BULK_STRINGS.retryLabel}
              </Button>
              <IconButton
                size="small"
                aria-label={SHARED_BULK_STRINGS.dismissLabel}
                onClick={() => setRateLimitState(null)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          }
        >
          <Typography variant="body2">
            {rateLimitState.retryAfterSeconds !== undefined
              ? `${SHARED_BULK_STRINGS.rateLimitPrefix} ${SHARED_BULK_STRINGS.rateLimitWaitPrefix} ${rateLimitState.retryAfterSeconds} ${SHARED_BULK_STRINGS.rateLimitWaitSuffix}`
              : `${SHARED_BULK_STRINGS.rateLimitPrefix} ${SHARED_BULK_STRINGS.rateLimitGenericWait}`}
          </Typography>
          {rateLimitState.detail ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.25 }}
            >
              {rateLimitState.detail}
            </Typography>
          ) : null}
        </Alert>
      ) : null}

      {inlineError ? (
        <Alert
          severity="error"
          data-testid="bulk-error-alert"
          action={
            <IconButton
              size="small"
              aria-label={SHARED_BULK_STRINGS.dismissLabel}
              onClick={() => setInlineError(null)}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          }
        >
          {inlineError}
        </Alert>
      ) : null}

      {/* Move to collections dialog */}
      <Dialog
        open={moveDialogOpen}
        onClose={() => (!busy ? setMoveDialogOpen(false) : undefined)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{SHARED_BULK_STRINGS.moveDialogTitle}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <FormControl component="fieldset">
              <FormLabel component="legend">{SHARED_BULK_STRINGS.moveModeLabel}</FormLabel>
              <RadioGroup
                value={moveMode}
                onChange={(e) => {
                  setMoveMode(e.target.value as BulkMoveMode);
                  setMoveValidationError(null);
                }}
              >
                <FormControlLabel
                  value="union"
                  control={<Radio size="small" />}
                  label={SHARED_BULK_STRINGS.moveModeUnionLabel}
                />
                <FormControlLabel
                  value="assign"
                  control={<Radio size="small" />}
                  label={SHARED_BULK_STRINGS.moveModeAssignLabel}
                />
              </RadioGroup>
            </FormControl>

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {SHARED_BULK_STRINGS.moveCollectionsHeading}
              </Typography>
              {collectionOptions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {SHARED_BULK_STRINGS.moveNoCollectionsHint}
                </Typography>
              ) : (
                <FormGroup>
                  {collectionOptions.map((col) => (
                    <FormControlLabel
                      key={col.id}
                      sx={{ pl: col.depth * 2 }}
                      control={
                        <Checkbox
                          size="small"
                          checked={moveCollectionIds.includes(col.id)}
                          onChange={() => handleToggleMoveCollection(col.id)}
                        />
                      }
                      label={col.title}
                    />
                  ))}
                </FormGroup>
              )}
            </Box>

            {moveValidationError ? <Alert severity="error">{moveValidationError}</Alert> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setMoveDialogOpen(false)}>
            {SHARED_BULK_STRINGS.cancelLabel}
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void handleSubmitMove()}>
            {SHARED_BULK_STRINGS.moveSubmitLabel}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add / remove tags dialog */}
      <Dialog
        open={tagsDialogOpen}
        onClose={() => (!busy ? setTagsDialogOpen(false) : undefined)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {tagsDialogMode === 'addTags'
            ? SHARED_BULK_STRINGS.addTagsDialogTitle
            : SHARED_BULK_STRINGS.removeTagsDialogTitle}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TagAutocompleteInput
              value={tagInputs}
              onChange={(next) => {
                setTagInputs(next);
                setTagsValidationError(null);
              }}
              disabled={busy}
              error={Boolean(tagsValidationError)}
              helperText={tagsValidationError ?? undefined}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setTagsDialogOpen(false)}>
            {SHARED_BULK_STRINGS.cancelLabel}
          </Button>
          <Button variant="contained" disabled={busy} onClick={() => void handleSubmitTags()}>
            {SHARED_BULK_STRINGS.tagsApplyLabel}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete permanently confirmation dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => (!busy ? setDeleteConfirmOpen(false) : undefined)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{SHARED_BULK_STRINGS.deleteConfirmTitle}</DialogTitle>
        <DialogContent>
          <DialogContentText>{SHARED_BULK_STRINGS.deleteConfirmDescription}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDeleteConfirmOpen(false)}>
            {SHARED_BULK_STRINGS.cancelLabel}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={busy}
            onClick={() => void handleConfirmDelete()}
          >
            {SHARED_BULK_STRINGS.deleteConfirmSubmit}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
