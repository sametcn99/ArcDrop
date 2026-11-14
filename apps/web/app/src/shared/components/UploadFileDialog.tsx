import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useId, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { Bookmark } from '../../api/schemas/bookmarks';
import { ApiError, toApiError } from '../../api/schemas/problem';
import { selectSortedCollections, useLibraryStore } from '../../stores/libraryStore';
import { uploadBookmarkFileAction } from '../actions/bookmarkActions';
import { SHARED_UPLOAD_STRINGS } from '../strings';
import { formatFileSize } from '../utils/fileFormat';
import { TagAutocompleteInput } from './TagAutocompleteInput';

export interface UploadFileDialogProps {
  open: boolean;
  onClose: () => void;
  initialCollectionId?: string;
  onUploaded?: (bookmark: Bookmark) => void;
}

function UploadFileDialogBody({
  onClose,
  initialCollectionId,
  onUploaded,
}: Omit<UploadFileDialogProps, 'open'>) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const collectionsById = useLibraryStore((s) => s.collectionsById);
  const collections = useMemo(
    () =>
      selectSortedCollections({ collectionsById } as Parameters<typeof selectSortedCollections>[0]),
    [collectionsById],
  );

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [title, setTitle] = useState('');
  const [collectionOverride, setCollectionOverride] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const collectionValue = collectionOverride ?? initialCollectionId ?? '';

  const acceptFile = (file: File | null | undefined) => {
    if (!file) return;
    setSelectedFile(file);
    setValidationError(null);
    setUploadError(null);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    if (uploading) return;
    const droppedFile = event.dataTransfer?.files?.[0];
    acceptFile(droppedFile);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!uploading && !isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (uploading) return;

    setValidationError(null);
    setUploadError(null);

    if (!selectedFile) {
      setValidationError(SHARED_UPLOAD_STRINGS.missingFileError);
      return;
    }

    setUploading(true);
    try {
      const trimmedCollection = collectionValue.trim();
      const created = await uploadBookmarkFileAction({
        file: selectedFile,
        title: title.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        collectionIds: trimmedCollection ? [trimmedCollection] : undefined,
        favorite,
      });
      onUploaded?.(created);
      onClose();
    } catch (err) {
      setUploadError(toApiError(err));
    } finally {
      setUploading(false);
    }
  };

  const errorLimitBytes = uploadError?.problem.limitBytes;
  const errorUsedBytes = uploadError?.problem.usedBytes;
  const errorResetAt = uploadError?.problem.resetAt;

  return (
    <Stack component="form" onSubmit={handleSubmit} noValidate>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {SHARED_UPLOAD_STRINGS.dialogDescription}
          </Typography>

          {validationError ? <Alert severity="warning">{validationError}</Alert> : null}

          {uploadError ? (
            <Alert severity="error" data-testid="upload-error-alert">
              <Stack spacing={0.5}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {uploadError.detail}
                </Typography>
                {errorLimitBytes !== undefined || errorUsedBytes !== undefined ? (
                  <Typography variant="caption" color="inherit">
                    {[
                      errorUsedBytes !== undefined
                        ? `${SHARED_UPLOAD_STRINGS.quotaUsedPrefix}: ${formatFileSize(errorUsedBytes)}`
                        : null,
                      errorLimitBytes !== undefined
                        ? `${SHARED_UPLOAD_STRINGS.quotaLimitPrefix}: ${formatFileSize(errorLimitBytes)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' / ')}
                  </Typography>
                ) : null}
                {errorResetAt ? (
                  <Typography variant="caption" color="inherit" data-testid="upload-quota-reset">
                    {`${SHARED_UPLOAD_STRINGS.quotaResetPrefix}: ${new Date(errorResetAt).toLocaleString()} (${errorResetAt})`}
                  </Typography>
                ) : null}
              </Stack>
            </Alert>
          ) : null}

          <Paper
            variant="outlined"
            data-testid="upload-dropzone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            sx={{
              p: 2.5,
              textAlign: 'center',
              borderStyle: 'dashed',
              borderWidth: 2,
              borderColor: isDragOver ? 'primary.main' : 'divider',
              bgcolor: isDragOver ? 'action.hover' : 'background.default',
              transition: 'border-color 150ms ease, background-color 150ms ease',
            }}
          >
            <Box
              component="input"
              id={inputId}
              ref={fileInputRef}
              type="file"
              aria-label={SHARED_UPLOAD_STRINGS.fileInputLabel}
              onChange={(e) => {
                const target = e.target as HTMLInputElement;
                acceptFile(target.files?.[0]);
              }}
              sx={{ display: 'none' }}
            />

            {selectedFile ? (
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', justifyContent: 'space-between', textAlign: 'left' }}
              >
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                  <InsertDriveFileOutlinedIcon color="primary" />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {selectedFile.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {`${formatFileSize(selectedFile.size)} · ${selectedFile.type || 'application/octet-stream'}`}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {SHARED_UPLOAD_STRINGS.changeFileLabel}
                  </Button>
                  <IconButton
                    size="small"
                    aria-label={SHARED_UPLOAD_STRINGS.removeFileLabel}
                    disabled={uploading}
                    onClick={() => {
                      setSelectedFile(null);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                  >
                    <DeleteOutlineOutlinedIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={1.25} sx={{ alignItems: 'center' }}>
                <CloudUploadOutlinedIcon color={isDragOver ? 'primary' : 'action'} fontSize="large" />
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {isDragOver
                    ? SHARED_UPLOAD_STRINGS.dropzoneActiveHeading
                    : SHARED_UPLOAD_STRINGS.dropzoneHeading}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {SHARED_UPLOAD_STRINGS.dropzoneFormatsHint}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {SHARED_UPLOAD_STRINGS.chooseFileLabel}
                </Button>
              </Stack>
            )}
          </Paper>

          {uploading ? (
            <Stack spacing={0.5} data-testid="upload-progress">
              <LinearProgress aria-label={SHARED_UPLOAD_STRINGS.uploadProgressLabel} />
              <Typography variant="caption" color="text.secondary">
                {SHARED_UPLOAD_STRINGS.submittingLabel}
              </Typography>
            </Stack>
          ) : null}

          <TextField
            fullWidth
            label={SHARED_UPLOAD_STRINGS.titleLabel}
            placeholder={SHARED_UPLOAD_STRINGS.titlePlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={uploading}
          />

          <TextField
            select
            fullWidth
            label={SHARED_UPLOAD_STRINGS.collectionLabel}
            value={collections.some((c) => c.id === collectionValue) ? collectionValue : ''}
            onChange={(e) => setCollectionOverride(e.target.value)}
            disabled={uploading}
          >
            <MenuItem value="">{SHARED_UPLOAD_STRINGS.collectionNoneOption}</MenuItem>
            {collections.map((col) => (
              <MenuItem key={col.id} value={col.id}>
                {col.title}
              </MenuItem>
            ))}
          </TextField>

          <TagAutocompleteInput
            value={tags}
            onChange={setTags}
            label={SHARED_UPLOAD_STRINGS.tagsLabel}
            disabled={uploading}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={favorite}
                onChange={(e) => setFavorite(e.target.checked)}
                disabled={uploading}
              />
            }
            label={SHARED_UPLOAD_STRINGS.favoriteLabel}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={uploading}>
          {SHARED_UPLOAD_STRINGS.cancelLabel}
        </Button>
        <Button type="submit" variant="contained" disabled={uploading}>
          {uploading ? SHARED_UPLOAD_STRINGS.submittingLabel : SHARED_UPLOAD_STRINGS.submitLabel}
        </Button>
      </DialogActions>
    </Stack>
  );
}

export function UploadFileDialog({
  open,
  onClose,
  initialCollectionId,
  onUploaded,
}: UploadFileDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{SHARED_UPLOAD_STRINGS.dialogTitle}</DialogTitle>
      {open ? (
        <UploadFileDialogBody
          onClose={onClose}
          initialCollectionId={initialCollectionId}
          onUploaded={onUploaded}
        />
      ) : null}
    </Dialog>
  );
}
