import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import RssFeedOutlinedIcon from '@mui/icons-material/RssFeedOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { collectionsApi } from '../../api/endpoints/collections';
import type { Collection, CollectionShareResponse } from '../../api/schemas/collections';
import { toApiError } from '../../api/schemas/problem';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import { setCollectionShareAction } from '../actions/collectionActions';
import { SHARED_COLLECTION_STRINGS } from '../strings';

export interface CollectionShareDialogProps {
  open: boolean;
  collection: Collection | null;
  onClose: () => void;
}

function CollectionShareDialogInner({
  collection,
  onClose,
}: {
  collection: Collection;
  onClose: () => void;
}) {
  const liveCollection = useLibraryStore((s) => s.collectionsById[collection.id] ?? collection);
  const enqueueSnackbar = useUiStore((s) => s.enqueueSnackbar);

  const [shareResponse, setShareResponse] = useState<CollectionShareResponse | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEnabled = liveCollection.share.enabled;
  const activeToken = shareResponse?.shareToken ?? liveCollection.share.shareToken;
  const publicPath =
    shareResponse?.publicPath ??
    (isEnabled && activeToken ? `/api/v1/public/collections/${activeToken}` : null);
  const rssPath =
    shareResponse?.rssPath ??
    (isEnabled && activeToken ? `/api/v1/public/collections/${activeToken}/rss` : null);

  const publicUrl = publicPath ? collectionsApi.resolveShareUrl(publicPath) : '';
  const rssUrl = rssPath ? collectionsApi.resolveShareUrl(rssPath) : '';

  const handleToggleShare = async (nextEnabled: boolean) => {
    if (nextEnabled) {
      setConfirmingDisable(false);
      setSubmitting(true);
      setError(null);
      try {
        const res = await setCollectionShareAction(liveCollection.id, true);
        setShareResponse(res);
      } catch (err) {
        const apiErr = toApiError(err);
        setError(apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Disabling requires confirmation noting token rotation on re-enable.
    setConfirmingDisable(true);
  };

  const handleConfirmDisable = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await setCollectionShareAction(liveCollection.id, false);
      setShareResponse(res);
      setConfirmingDisable(false);
    } catch (err) {
      const apiErr = toApiError(err);
      setError(apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async (value: string, successMessage: string) => {
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        enqueueSnackbar({ message: successMessage, severity: 'success' });
        return;
      }
      enqueueSnackbar({ message: SHARED_COLLECTION_STRINGS.shareCopyFailed, severity: 'warning' });
    } catch {
      enqueueSnackbar({ message: SHARED_COLLECTION_STRINGS.shareCopyFailed, severity: 'warning' });
    }
  };

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{`${SHARED_COLLECTION_STRINGS.shareDialogTitle}: ${liveCollection.title}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}

          <FormControlLabel
            control={
              <Switch
                checked={isEnabled}
                onChange={(_event, checked) => void handleToggleShare(checked)}
                disabled={submitting}
              />
            }
            label={SHARED_COLLECTION_STRINGS.shareToggleLabel}
          />

          <Typography variant="body2" color="text.secondary">
            {isEnabled
              ? SHARED_COLLECTION_STRINGS.shareEnabledDescription
              : SHARED_COLLECTION_STRINGS.shareDisabledDescription}
          </Typography>

          {confirmingDisable ? (
            <Alert
              severity="warning"
              action={
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    onClick={() => setConfirmingDisable(false)}
                    disabled={submitting}
                  >
                    {SHARED_COLLECTION_STRINGS.shareDisableCancel}
                  </Button>
                  <Button
                    size="small"
                    color="warning"
                    variant="contained"
                    onClick={() => void handleConfirmDisable()}
                    disabled={submitting}
                  >
                    {SHARED_COLLECTION_STRINGS.shareDisableConfirm}
                  </Button>
                </Stack>
              }
            >
              <Typography variant="subtitle2" gutterBottom>
                {SHARED_COLLECTION_STRINGS.shareDisableConfirmTitle}
              </Typography>
              <Typography variant="body2">
                {SHARED_COLLECTION_STRINGS.shareDisableConfirmBody}
              </Typography>
            </Alert>
          ) : null}

          {isEnabled && publicUrl ? (
            <Stack spacing={2}>
              <TextField
                fullWidth
                size="small"
                label={SHARED_COLLECTION_STRINGS.sharePublicUrlLabel}
                value={publicUrl}
                slotProps={{
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={SHARED_COLLECTION_STRINGS.shareCopyUrlLabel}>
                          <IconButton
                            edge="end"
                            size="small"
                            aria-label={`${SHARED_COLLECTION_STRINGS.shareCopyUrlLabel}: ${SHARED_COLLECTION_STRINGS.sharePublicUrlLabel}`}
                            onClick={() =>
                              void handleCopy(
                                publicUrl,
                                SHARED_COLLECTION_STRINGS.shareCopiedPublic,
                              )
                            }
                          >
                            <ContentCopyOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  },
                }}
              />

              <TextField
                fullWidth
                size="small"
                label={SHARED_COLLECTION_STRINGS.shareRssUrlLabel}
                value={rssUrl}
                slotProps={{
                  input: {
                    readOnly: true,
                    startAdornment: (
                      <InputAdornment position="start">
                        <RssFeedOutlinedIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={SHARED_COLLECTION_STRINGS.shareCopyUrlLabel}>
                          <IconButton
                            edge="end"
                            size="small"
                            aria-label={`${SHARED_COLLECTION_STRINGS.shareCopyUrlLabel}: ${SHARED_COLLECTION_STRINGS.shareRssUrlLabel}`}
                            onClick={() =>
                              void handleCopy(rssUrl, SHARED_COLLECTION_STRINGS.shareCopiedRss)
                            }
                          >
                            <ContentCopyOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {SHARED_COLLECTION_STRINGS.shareClose}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function CollectionShareDialog({ open, collection, onClose }: CollectionShareDialogProps) {
  if (!open || !collection) {
    return null;
  }

  return (
    <CollectionShareDialogInner key={collection.id} collection={collection} onClose={onClose} />
  );
}
