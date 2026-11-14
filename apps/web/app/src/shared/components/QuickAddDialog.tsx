import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState, type FormEvent } from 'react';
import { createBookmarkRequestSchema } from '../../api/schemas/bookmarks';
import { toApiError } from '../../api/schemas/problem';
import { selectSortedCollections, useLibraryStore } from '../../stores/libraryStore';
import { createBookmarkAction } from '../actions/bookmarkActions';
import { SHARED_QUICK_ADD_STRINGS } from '../strings';
import { TagAutocompleteInput } from './TagAutocompleteInput';

export interface QuickAddInitialValues {
  url?: string;
  title?: string;
  collection?: string;
  tags?: string[];
  favorite?: boolean;
}

export interface QuickAddDialogProps {
  open: boolean;
  onClose: () => void;
  initialValues?: QuickAddInitialValues;
  onCreated?: (bookmarkId: string) => void;
}

function QuickAddDialogBody({
  onClose,
  initialValues,
  onCreated,
}: Omit<QuickAddDialogProps, 'open'>) {
  const collectionsById = useLibraryStore((s) => s.collectionsById);
  const collections = useMemo(
    () =>
      selectSortedCollections({ collectionsById } as Parameters<typeof selectSortedCollections>[0]),
    [collectionsById],
  );

  const resolvedInitialCollectionId = useMemo(() => {
    const rawCol = initialValues?.collection?.trim() ?? '';
    if (!rawCol) return '';
    const matched = collections.find(
      (col) => col.id === rawCol || col.title.trim().toLowerCase() === rawCol.toLowerCase(),
    );
    return matched ? matched.id : rawCol;
  }, [collections, initialValues?.collection]);

  const [url, setUrl] = useState(initialValues?.url ?? '');
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [collectionOverride, setCollectionOverride] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>(initialValues?.tags ?? []);
  const [favorite, setFavorite] = useState(Boolean(initialValues?.favorite));
  const [urlError, setUrlError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const collectionValue = collectionOverride ?? resolvedInitialCollectionId;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    setUrlError(null);
    setSubmitError(null);

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setUrlError('Enter a valid http(s) URL');
      return;
    }

    const trimmedTitle = title.trim();
    const candidate = {
      url: trimmedUrl,
      ...(trimmedTitle ? { title: trimmedTitle } : {}),
      favorite,
    };

    const parsed = createBookmarkRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      const urlIssue = parsed.error.issues.find((issue) => issue.path[0] === 'url');
      if (urlIssue) {
        setUrlError(urlIssue.message);
      } else {
        setSubmitError(parsed.error.issues[0]?.message ?? 'Invalid bookmark input.');
      }
      return;
    }

    setSubmitting(true);
    try {
      const trimmedCollection = collectionValue.trim();
      const created = await createBookmarkAction({
        body: parsed.data,
        query: trimmedCollection ? { collection: trimmedCollection } : undefined,
        tags,
      });
      onCreated?.(created.id);
      onClose();
    } catch (err) {
      setSubmitError(toApiError(err).detail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Stack component="form" onSubmit={handleSubmit} noValidate>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {SHARED_QUICK_ADD_STRINGS.dialogDescription}
          </Typography>

          {submitError ? <Alert severity="error">{submitError}</Alert> : null}

          <TextField
            required
            autoFocus
            fullWidth
            label={SHARED_QUICK_ADD_STRINGS.urlLabel}
            placeholder={SHARED_QUICK_ADD_STRINGS.urlPlaceholder}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(null);
            }}
            error={Boolean(urlError)}
            helperText={urlError}
            disabled={submitting}
          />

          <TextField
            fullWidth
            label={SHARED_QUICK_ADD_STRINGS.titleLabel}
            placeholder={SHARED_QUICK_ADD_STRINGS.titlePlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
          />

          <TextField
            select
            fullWidth
            label={SHARED_QUICK_ADD_STRINGS.collectionLabel}
            value={collections.some((c) => c.id === collectionValue) ? collectionValue : ''}
            onChange={(e) => setCollectionOverride(e.target.value)}
            disabled={submitting}
          >
            <MenuItem value="">{SHARED_QUICK_ADD_STRINGS.collectionNoneOption}</MenuItem>
            {collections.map((col) => (
              <MenuItem key={col.id} value={col.id}>
                {col.title}
              </MenuItem>
            ))}
          </TextField>

          <TagAutocompleteInput
            value={tags}
            onChange={setTags}
            label={SHARED_QUICK_ADD_STRINGS.tagsLabel}
            disabled={submitting}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={favorite}
                onChange={(e) => setFavorite(e.target.checked)}
                disabled={submitting}
              />
            }
            label={SHARED_QUICK_ADD_STRINGS.favoriteLabel}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>
          {SHARED_QUICK_ADD_STRINGS.cancelLabel}
        </Button>
        <Button type="submit" variant="contained" disabled={submitting}>
          {submitting
            ? SHARED_QUICK_ADD_STRINGS.submittingLabel
            : SHARED_QUICK_ADD_STRINGS.submitLabel}
        </Button>
      </DialogActions>
    </Stack>
  );
}

export function QuickAddDialog({ open, onClose, initialValues, onCreated }: QuickAddDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{SHARED_QUICK_ADD_STRINGS.dialogTitle}</DialogTitle>
      {open ? (
        <QuickAddDialogBody onClose={onClose} initialValues={initialValues} onCreated={onCreated} />
      ) : null}
    </Dialog>
  );
}
