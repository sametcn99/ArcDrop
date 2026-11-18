import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { sendLibraryMessage } from '../shared/libraryMessages';
import { errorString, strings } from '../shared/strings';
import type { TabItem } from '../shared/menuActions';
import type { CollectionOption } from './EditorView';

export interface SaveAllTabsDialogProps {
  open: boolean;
  onClose: () => void;
  collectionOptions: CollectionOption[];
}

/**
 * "Save all tabs" (E4): shows the deduped savable tab count, picks the
 * target collection, warns above 50 tabs, then runs the bulk save in the
 * background and reports the summary.
 */
export function SaveAllTabsDialog({ open, onClose, collectionOptions }: SaveAllTabsDialogProps) {
  const [tabs, setTabs] = useState<TabItem[] | null>(null);
  const [duplicatesRemoved, setDuplicatesRemoved] = useState(0);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [confirmOverLimit, setConfirmOverLimit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<{
    saved: number;
    skipped: number;
    failed: number;
    duplicatesRemoved: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const response = await sendLibraryMessage({ type: 'library/list-savable-tabs' });
        if (cancelled || !response.ok || response.kind !== 'savable-tabs') return;
        setTabs(response.tabs);
        setDuplicatesRemoved(response.duplicatesRemoved);
      } catch {
        if (!cancelled) setError(errorString('NETWORK_ERROR'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const run = (): void => {
    setBusy(true);
    setError(null);
    void sendLibraryMessage({ type: 'library/save-all-tabs', collectionId })
      .then((response) => {
        if (!response.ok) {
          setError(errorString(response.code));
          return;
        }
        if (response.kind === 'save-all-summary') {
          setSummary(response.summary);
        }
      })
      .catch(() => {
        setError(errorString('NETWORK_ERROR'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const count = tabs?.length ?? 0;
  const overLimit = count > 50;
  const selected = collectionOptions.find((option) => option.id === collectionId) ?? null;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{strings.popup.saveAllTabsTitle}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {error !== null ? <Alert severity="error">{error}</Alert> : null}
          {summary !== null ? (
            <Alert severity={summary.failed > 0 ? 'warning' : 'success'}>
              {strings.popup.saveAllTabsDone(summary.saved, summary.skipped, summary.failed)}
              {strings.popup.saveAllTabsDuplicatesNote(summary.duplicatesRemoved)}
            </Alert>
          ) : tabs === null ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                {strings.popup.connecting}
              </Typography>
            </Stack>
          ) : (
            <>
              <Typography variant="body2">{strings.popup.saveAllTabsCount(count)}</Typography>
              {duplicatesRemoved > 0 ? (
                <Typography variant="caption" color="text.secondary">
                  {strings.popup.saveAllTabsDuplicates(duplicatesRemoved)}
                </Typography>
              ) : null}
              {overLimit ? (
                <Alert severity="warning">{strings.popup.saveAllTabsWarning}</Alert>
              ) : null}
              <Autocomplete
                options={collectionOptions}
                value={selected}
                getOptionLabel={(option) => option.title}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                onChange={(_event, value) => setCollectionId(value?.id ?? null)}
                renderOption={(props, option) => {
                  const { key, ...optionProps } = props;
                  return (
                    <Box
                      key={key}
                      component="li"
                      sx={{ pl: 2 + option.depth * 2 }}
                      {...optionProps}
                    >
                      {option.title}
                    </Box>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={strings.popup.saveAllTabsCollection}
                    placeholder={strings.popup.editorCollectionUnsorted}
                    size="small"
                  />
                )}
                disabled={busy}
              />
              {overLimit ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={confirmOverLimit}
                      onChange={(event) => setConfirmOverLimit(event.target.checked)}
                      disabled={busy}
                    />
                  }
                  label={strings.popup.saveAllTabsConfirm}
                />
              ) : null}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {summary !== null ? strings.popup.closeButton : strings.popup.cancelButton}
        </Button>
        {summary === null ? (
          <Button
            variant="contained"
            onClick={run}
            disabled={busy || tabs === null || count === 0 || (overLimit && !confirmOverLimit)}
          >
            {busy ? <CircularProgress size={20} /> : strings.popup.saveAllTabsRun}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}
