import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import type { MergeCollectionsResponse } from '../../api/schemas/collections';
import { toApiError } from '../../api/schemas/problem';
import { selectSortedCollections, useLibraryStore } from '../../stores/libraryStore';
import { mergeCollectionsAction } from '../actions/collectionActions';
import { SHARED_COLLECTION_STRINGS } from '../strings';

export interface CollectionMergeDialogProps {
  open: boolean;
  initialSourceId?: string | null;
  onClose: () => void;
  onMerged?: (result: MergeCollectionsResponse) => void;
}

function CollectionMergeDialogInner({
  initialSourceId = null,
  onClose,
  onMerged,
}: Omit<CollectionMergeDialogProps, 'open'>) {
  const collectionsById = useLibraryStore((s) => s.collectionsById);
  const allCollections = selectSortedCollections({ collectionsById } as Parameters<
    typeof selectSortedCollections
  >[0]);

  const [sourceIds, setSourceIds] = useState<string[]>(() =>
    initialSourceId ? [initialSourceId] : [],
  );
  const [targetId, setTargetId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MergeCollectionsResponse | null>(null);

  const toggleSource = (id: string) => {
    setError(null);
    setSourceIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (sourceIds.length === 0) {
      setError(SHARED_COLLECTION_STRINGS.mergeValidationNoSources);
      return;
    }
    if (!targetId) {
      setError(SHARED_COLLECTION_STRINGS.mergeValidationNoTarget);
      return;
    }
    if (sourceIds.includes(targetId)) {
      setError(SHARED_COLLECTION_STRINGS.mergeValidationOverlap);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await mergeCollectionsAction(sourceIds, targetId);
      setSummary(result);
      onMerged?.(result);
    } catch (err) {
      const apiErr = toApiError(err);
      setError(apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      {summary ? (
        <>
          <DialogTitle>{SHARED_COLLECTION_STRINGS.mergeSummaryTitle}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <Alert severity="success">
                {`${SHARED_COLLECTION_STRINGS.mergeTargetLabel}: ${summary.target.title}`}
              </Alert>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      {SHARED_COLLECTION_STRINGS.mergeSummaryMovedBookmarks}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {summary.movedBookmarks}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      {SHARED_COLLECTION_STRINGS.mergeSummaryMovedChildren}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {summary.movedChildren}
                    </Typography>
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">
                      {SHARED_COLLECTION_STRINGS.mergeSummaryTrashedCount}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {summary.trashedIds.length}
                    </Typography>
                  </Stack>
                </Stack>
              </Paper>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={onClose}>
              {SHARED_COLLECTION_STRINGS.mergeDone}
            </Button>
          </DialogActions>
        </>
      ) : (
        <Box component="form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <DialogTitle>{SHARED_COLLECTION_STRINGS.mergeDialogTitle}</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ pt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                {SHARED_COLLECTION_STRINGS.mergeDescription}
              </Typography>

              {error ? <Alert severity="error">{error}</Alert> : null}

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  {SHARED_COLLECTION_STRINGS.mergeSourcesLabel}
                </Typography>
                <Paper variant="outlined" sx={{ maxHeight: 220, overflowY: 'auto' }}>
                  <List dense disablePadding>
                    {allCollections.map((col) => {
                      const checked = sourceIds.includes(col.id);
                      return (
                        <ListItem key={col.id} disablePadding>
                          <ListItemButton
                            dense
                            onClick={() => toggleSource(col.id)}
                            disabled={submitting}
                          >
                            <ListItemIcon sx={{ minWidth: 36 }}>
                              <Checkbox
                                edge="start"
                                size="small"
                                checked={checked}
                                tabIndex={-1}
                                disableRipple
                                slotProps={{
                                  input: {
                                    'aria-label': `${SHARED_COLLECTION_STRINGS.mergeSourcesLabel}: ${col.title}`,
                                  },
                                }}
                              />
                            </ListItemIcon>
                            <ListItemText
                              primary={col.title}
                              secondary={`${col.bookmarkCount} bookmarks`}
                            />
                          </ListItemButton>
                        </ListItem>
                      );
                    })}
                  </List>
                </Paper>
              </Box>

              <FormControl fullWidth size="small">
                <InputLabel id="merge-target-select-label">
                  {SHARED_COLLECTION_STRINGS.mergeTargetLabel}
                </InputLabel>
                <Select
                  labelId="merge-target-select-label"
                  label={SHARED_COLLECTION_STRINGS.mergeTargetLabel}
                  value={targetId}
                  onChange={(e) => {
                    setError(null);
                    setTargetId(e.target.value);
                  }}
                  disabled={submitting}
                >
                  {allCollections.map((col) => (
                    <MenuItem key={col.id} value={col.id}>
                      {col.title}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} disabled={submitting}>
              {SHARED_COLLECTION_STRINGS.mergeCancel}
            </Button>
            <Button type="submit" variant="contained" disabled={submitting}>
              {SHARED_COLLECTION_STRINGS.mergeSubmit}
            </Button>
          </DialogActions>
        </Box>
      )}
    </Dialog>
  );
}

export function CollectionMergeDialog({
  open,
  initialSourceId = null,
  onClose,
  onMerged,
}: CollectionMergeDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <CollectionMergeDialogInner
      key={initialSourceId ?? 'none'}
      initialSourceId={initialSourceId}
      onClose={onClose}
      onMerged={onMerged}
    />
  );
}
