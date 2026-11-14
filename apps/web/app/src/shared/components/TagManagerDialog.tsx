import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { renameTagRequestSchema } from '../../api/schemas/bookmarks';
import { toApiError } from '../../api/schemas/problem';
import { selectSortedTags, useLibraryStore } from '../../stores/libraryStore';
import { deleteTagAction, refreshTagsAction, renameTagAction } from '../actions/tagActions';
import { SHARED_TAG_STRINGS } from '../strings';

export interface TagManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

function TagManagerDialogBody({ onClose }: { onClose: () => void }) {
  const tagsById = useLibraryStore((s) => s.tagsById);
  const tags = useMemo(
    () => selectSortedTags({ tagsById } as Parameters<typeof selectSortedTags>[0]),
    [tagsById],
  );

  const [filterText, setFilterText] = useState('');
  const [editingTagName, setEditingTagName] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshTagsAction().catch(() => undefined);
  }, []);

  const filteredTags = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) return tags;
    return tags.filter((tag) => tag.name.toLowerCase().includes(query));
  }, [filterText, tags]);

  const mergeTargetName = useMemo(() => {
    if (!editingTagName) return null;
    const trimmed = renameDraft.trim();
    if (!trimmed) return null;
    const normalized = trimmed.toLowerCase();
    if (normalized === editingTagName.toLowerCase()) return null;
    const existing = tags.find((tag) => tag.name.toLowerCase() === normalized);
    return existing ? existing.name : null;
  }, [editingTagName, renameDraft, tags]);

  const handleStartRename = (tagName: string) => {
    setDeleteTarget(null);
    setEditingTagName(tagName);
    setRenameDraft(tagName);
    setError(null);
  };

  const handleCancelRename = () => {
    setEditingTagName(null);
    setRenameDraft('');
    setError(null);
  };

  const handleApplyRename = async () => {
    if (!editingTagName || busy) return;
    const parsed = renameTagRequestSchema.safeParse({ name: renameDraft });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid tag name.');
      return;
    }

    if (parsed.data.name === editingTagName) {
      handleCancelRename();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await renameTagAction(editingTagName, parsed.data.name);
      setEditingTagName(null);
      setRenameDraft('');
    } catch (err) {
      setError(toApiError(err).detail);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTagAction(deleteTarget);
      setDeleteTarget(null);
    } catch (err) {
      setError(toApiError(err).detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <TextField
            size="small"
            fullWidth
            label={SHARED_TAG_STRINGS.managerFilterLabel}
            placeholder={SHARED_TAG_STRINGS.managerFilterPlaceholder}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />

          {tags.length === 0 ? (
            <Box sx={{ py: 3, textAlign: 'center' }}>
              <LocalOfferOutlinedIcon color="disabled" sx={{ fontSize: 36, mb: 1 }} />
              <Typography variant="subtitle2">{SHARED_TAG_STRINGS.managerEmptyTitle}</Typography>
              <Typography variant="body2" color="text.secondary">
                {SHARED_TAG_STRINGS.managerEmptyHint}
              </Typography>
            </Box>
          ) : filteredTags.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              {SHARED_TAG_STRINGS.managerNoMatches}
            </Typography>
          ) : (
            <List dense disablePadding>
              {filteredTags.map((tag, index) => {
                const isEditing = editingTagName === tag.name;
                const isDeleting = deleteTarget === tag.name;
                const countLabel =
                  tag.count === 1
                    ? SHARED_TAG_STRINGS.managerCountSingular
                    : `${tag.count} ${SHARED_TAG_STRINGS.managerCountPluralSuffix}`;

                return (
                  <Box key={tag.id}>
                    {index > 0 ? <Divider /> : null}
                    <ListItem
                      sx={{ px: 0, py: 1, flexDirection: 'column', alignItems: 'stretch', gap: 1 }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', minWidth: 0 }}
                        >
                          <Chip size="small" label={`#${tag.name}`} variant="outlined" />
                          <ListItemText
                            primary={countLabel}
                            slotProps={{
                              primary: { variant: 'caption', color: 'text.secondary' },
                            }}
                          />
                        </Stack>

                        <Stack direction="row" spacing={0.5}>
                          <Tooltip title={SHARED_TAG_STRINGS.managerRenameAction}>
                            <IconButton
                              size="small"
                              aria-label={`${SHARED_TAG_STRINGS.managerRenameAction} ${tag.name}`}
                              disabled={busy}
                              onClick={() => handleStartRename(tag.name)}
                            >
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={SHARED_TAG_STRINGS.managerDeleteAction}>
                            <IconButton
                              size="small"
                              color="error"
                              aria-label={`${SHARED_TAG_STRINGS.managerDeleteAction} ${tag.name}`}
                              disabled={busy}
                              onClick={() => {
                                setEditingTagName(null);
                                setDeleteTarget(tag.name);
                                setError(null);
                              }}
                            >
                              <DeleteOutlineOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Stack>

                      {isEditing ? (
                        <Stack spacing={1} sx={{ pt: 0.5 }}>
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <TextField
                              size="small"
                              fullWidth
                              label={SHARED_TAG_STRINGS.managerRenameLabel}
                              value={renameDraft}
                              disabled={busy}
                              onChange={(e) => setRenameDraft(e.target.value)}
                            />
                            <Button
                              size="small"
                              variant="contained"
                              disabled={busy}
                              onClick={() => void handleApplyRename()}
                            >
                              {SHARED_TAG_STRINGS.managerRenameSave}
                            </Button>
                            <Button size="small" disabled={busy} onClick={handleCancelRename}>
                              {SHARED_TAG_STRINGS.managerRenameCancel}
                            </Button>
                          </Stack>
                          {mergeTargetName ? (
                            <Alert severity="info">
                              {`${SHARED_TAG_STRINGS.managerMergeWarningPrefix} "#${mergeTargetName}" ${SHARED_TAG_STRINGS.managerMergeWarningSuffix}`}
                            </Alert>
                          ) : null}
                        </Stack>
                      ) : null}

                      {isDeleting ? (
                        <Alert
                          severity="warning"
                          action={
                            <Stack direction="row" spacing={1}>
                              <Button
                                size="small"
                                color="inherit"
                                disabled={busy}
                                onClick={() => setDeleteTarget(null)}
                              >
                                {SHARED_TAG_STRINGS.managerDeleteCancel}
                              </Button>
                              <Button
                                size="small"
                                color="error"
                                variant="contained"
                                disabled={busy}
                                onClick={() => void handleConfirmDelete()}
                              >
                                {SHARED_TAG_STRINGS.managerDeleteConfirm}
                              </Button>
                            </Stack>
                          }
                        >
                          {`${SHARED_TAG_STRINGS.managerDeleteConfirmPrefix} "#${tag.name}" ${SHARED_TAG_STRINGS.managerDeleteConfirmSuffix}`}
                        </Alert>
                      ) : null}
                    </ListItem>
                  </Box>
                );
              })}
            </List>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{SHARED_TAG_STRINGS.managerClose}</Button>
      </DialogActions>
    </>
  );
}

export function TagManagerDialog({ open, onClose }: TagManagerDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{SHARED_TAG_STRINGS.managerDialogTitle}</DialogTitle>
      {open ? <TagManagerDialogBody onClose={onClose} /> : null}
    </Dialog>
  );
}
