import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { Collection } from '../../api/schemas/collections';
import { ApiError, toApiError } from '../../api/schemas/problem';
import { deleteCollectionAction } from '../actions/collectionActions';
import { SHARED_COLLECTION_STRINGS } from '../strings';

export interface CollectionDeleteDialogProps {
  open: boolean;
  collection: Collection | null;
  onClose: () => void;
  onDeleted?: (deletedId: string) => void;
}

function CollectionDeleteDialogInner({
  collection,
  onClose,
  onDeleted,
}: {
  collection: Collection;
  onClose: () => void;
  onDeleted?: (deletedId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [blockedDetail, setBlockedDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (cascade: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      await deleteCollectionAction(collection.id, cascade ? { cascade: 'trash' } : undefined);
      onDeleted?.(collection.id);
      onClose();
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr instanceof ApiError && apiErr.status === 409 && !cascade) {
        setBlockedDetail(apiErr.detail);
      } else {
        setError(apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{SHARED_COLLECTION_STRINGS.deleteTitle}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <Typography variant="body2">
            {`${SHARED_COLLECTION_STRINGS.deletePromptPrefix} "${collection.title}" ${SHARED_COLLECTION_STRINGS.deletePromptSuffix}`}
          </Typography>

          {blockedDetail ? (
            <Alert severity="warning">
              <Typography variant="subtitle2" gutterBottom>
                {SHARED_COLLECTION_STRINGS.deleteBlockedHeading}
              </Typography>
              <Typography variant="body2" gutterBottom>
                {blockedDetail}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {SHARED_COLLECTION_STRINGS.deleteCascadeHint}
              </Typography>
            </Alert>
          ) : null}

          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {SHARED_COLLECTION_STRINGS.deleteCancel}
        </Button>
        {blockedDetail ? (
          <Button
            variant="contained"
            color="error"
            onClick={() => void handleDelete(true)}
            disabled={submitting}
          >
            {SHARED_COLLECTION_STRINGS.deleteCascadeConfirm}
          </Button>
        ) : (
          <Button
            variant="contained"
            color="error"
            onClick={() => void handleDelete(false)}
            disabled={submitting}
          >
            {SHARED_COLLECTION_STRINGS.deleteConfirm}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function CollectionDeleteDialog({
  open,
  collection,
  onClose,
  onDeleted,
}: CollectionDeleteDialogProps) {
  if (!open || !collection) {
    return null;
  }

  return (
    <CollectionDeleteDialogInner
      key={collection.id}
      collection={collection}
      onClose={onClose}
      onDeleted={onDeleted}
    />
  );
}
