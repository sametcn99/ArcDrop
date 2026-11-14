import CheckIcon from '@mui/icons-material/Check';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import IconButton from '@mui/material/IconButton';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { useState, type FormEvent } from 'react';
import type { Collection } from '../../api/schemas/collections';
import { toApiError } from '../../api/schemas/problem';
import { selectSortedCollections, useLibraryStore } from '../../stores/libraryStore';
import { createCollectionAction, updateCollectionAction } from '../actions/collectionActions';
import { SHARED_COLLECTION_STRINGS } from '../strings';
import { COLLECTION_ICON_OPTIONS } from '../utils/collectionTree';
import { CollectionIcon } from './CollectionIcon';

export interface CollectionFormDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialCollection?: Collection | null;
  defaultParentId?: string | null;
  onClose: () => void;
  onSaved?: (collection: Collection) => void;
}

function CollectionFormDialogInner({
  mode,
  initialCollection = null,
  defaultParentId = null,
  onClose,
  onSaved,
}: Omit<CollectionFormDialogProps, 'open'>) {
  const theme = useTheme();
  const collectionsById = useLibraryStore((s) => s.collectionsById);
  const allCollections = selectSortedCollections({ collectionsById } as Parameters<
    typeof selectSortedCollections
  >[0]);

  const [title, setTitle] = useState(() =>
    mode === 'edit' && initialCollection ? initialCollection.title : '',
  );
  const [parentId, setParentId] = useState<string>(() =>
    mode === 'edit' && initialCollection
      ? (initialCollection.parentId ?? '')
      : (defaultParentId ?? ''),
  );
  const [icon, setIcon] = useState<string>(() =>
    mode === 'edit' && initialCollection ? (initialCollection.icon ?? '') : '',
  );
  const [color, setColor] = useState<string>(() =>
    mode === 'edit' && initialCollection ? (initialCollection.color ?? '') : '',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const colorSwatches = [
    { key: 'primary', label: 'Primary', value: theme.palette.primary.main },
    { key: 'secondary', label: 'Secondary', value: theme.palette.secondary.main },
    { key: 'info', label: 'Info', value: theme.palette.info.main },
    { key: 'success', label: 'Success', value: theme.palette.success.main },
    { key: 'warning', label: 'Warning', value: theme.palette.warning.main },
    { key: 'error', label: 'Error', value: theme.palette.error.main },
  ];

  const availableParents = allCollections.filter((col) =>
    mode === 'edit' && initialCollection ? col.id !== initialCollection.id : true,
  );

  const dialogTitle =
    mode === 'edit'
      ? SHARED_COLLECTION_STRINGS.formEditTitle
      : defaultParentId
        ? SHARED_COLLECTION_STRINGS.formCreateChildTitle
        : SHARED_COLLECTION_STRINGS.formCreateTitle;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError(SHARED_COLLECTION_STRINGS.formTitleRequired);
      return;
    }

    setSubmitting(true);
    setError(null);
    const trimmedColor = color.trim();
    const resolvedParentId = parentId === '' ? null : parentId;

    try {
      let saved: Collection;
      if (mode === 'edit' && initialCollection) {
        saved = await updateCollectionAction(initialCollection.id, {
          title: trimmedTitle,
          parentId: resolvedParentId,
          icon: icon ? icon : null,
          color: trimmedColor ? trimmedColor : null,
        });
      } else {
        saved = await createCollectionAction({
          title: trimmedTitle,
          parentId: resolvedParentId,
          ...(icon ? { icon } : {}),
          ...(trimmedColor ? { color: trimmedColor } : {}),
        });
      }
      onSaved?.(saved);
      onClose();
    } catch (err) {
      const apiErr = toApiError(err);
      setError(apiErr.detail || SHARED_COLLECTION_STRINGS.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={(e) => void handleSubmit(e)} noValidate>
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {error ? <Alert severity="error">{error}</Alert> : null}

            <TextField
              autoFocus
              required
              fullWidth
              label={SHARED_COLLECTION_STRINGS.formTitleLabel}
              placeholder={SHARED_COLLECTION_STRINGS.formTitlePlaceholder}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
            />

            <FormControl fullWidth size="small">
              <InputLabel id="collection-parent-select-label">
                {SHARED_COLLECTION_STRINGS.formParentLabel}
              </InputLabel>
              <Select
                labelId="collection-parent-select-label"
                label={SHARED_COLLECTION_STRINGS.formParentLabel}
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                disabled={submitting}
              >
                <MenuItem value="">{SHARED_COLLECTION_STRINGS.formParentRootOption}</MenuItem>
                {availableParents.map((col) => (
                  <MenuItem key={col.id} value={col.id}>
                    {col.title}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box>
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
              >
                <Typography variant="caption" color="text.secondary">
                  {SHARED_COLLECTION_STRINGS.formIconLabel}
                </Typography>
                {icon ? (
                  <Chip
                    size="small"
                    label={SHARED_COLLECTION_STRINGS.formIconNone}
                    onClick={() => setIcon('')}
                    disabled={submitting}
                  />
                ) : null}
              </Stack>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {COLLECTION_ICON_OPTIONS.map((option) => {
                  const selected = icon === option.key;
                  return (
                    <Tooltip key={option.key} title={option.label}>
                      <IconButton
                        size="small"
                        aria-label={option.label}
                        aria-pressed={selected}
                        color={selected ? 'primary' : 'default'}
                        onClick={() => setIcon(selected ? '' : option.key)}
                        disabled={submitting}
                        sx={{
                          border: 1,
                          borderColor: selected ? 'primary.main' : 'divider',
                        }}
                      >
                        <CollectionIcon iconName={option.key} fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  );
                })}
              </Stack>
            </Box>

            <Box>
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
              >
                <Typography variant="caption" color="text.secondary">
                  {SHARED_COLLECTION_STRINGS.formColorLabel}
                </Typography>
                {color ? (
                  <Chip
                    size="small"
                    label={SHARED_COLLECTION_STRINGS.formColorNone}
                    onClick={() => setColor('')}
                    disabled={submitting}
                  />
                ) : null}
              </Stack>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                {colorSwatches.map((swatch) => {
                  const selected = color.toLowerCase() === swatch.value.toLowerCase();
                  return (
                    <Tooltip key={swatch.key} title={swatch.label}>
                      <IconButton
                        size="small"
                        aria-label={`${SHARED_COLLECTION_STRINGS.formColorLabel}: ${swatch.label}`}
                        aria-pressed={selected}
                        onClick={() => setColor(selected ? '' : swatch.value)}
                        disabled={submitting}
                        sx={{
                          width: 28,
                          height: 28,
                          bgcolor: swatch.value,
                          color: 'common.white',
                          border: 2,
                          borderColor: selected ? 'text.primary' : 'transparent',
                          '&:hover': {
                            bgcolor: swatch.value,
                            opacity: 0.85,
                          },
                        }}
                      >
                        {selected ? <CheckIcon fontSize="inherit" /> : null}
                      </IconButton>
                    </Tooltip>
                  );
                })}
              </Stack>
              <TextField
                fullWidth
                size="small"
                sx={{ mt: 1.5 }}
                label={SHARED_COLLECTION_STRINGS.formColorCustomLabel}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                disabled={submitting}
              />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>
            {SHARED_COLLECTION_STRINGS.formCancel}
          </Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {mode === 'edit'
              ? SHARED_COLLECTION_STRINGS.formSaveSubmit
              : SHARED_COLLECTION_STRINGS.formCreateSubmit}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

export function CollectionFormDialog({
  open,
  mode,
  initialCollection = null,
  defaultParentId = null,
  onClose,
  onSaved,
}: CollectionFormDialogProps) {
  if (!open) {
    return null;
  }

  const dialogKey = `${mode}:${initialCollection?.id ?? 'new'}:${defaultParentId ?? ''}`;
  return (
    <CollectionFormDialogInner
      key={dialogKey}
      mode={mode}
      initialCollection={initialCollection}
      defaultParentId={defaultParentId}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
