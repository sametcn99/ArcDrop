import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import RestoreFromTrashOutlinedIcon from '@mui/icons-material/RestoreFromTrashOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { FormEvent } from 'react';
import type { Bookmark } from '../../../api/schemas/bookmarks';
import { BookmarkIconBadge } from '../../../shared/components/BookmarkIconBadge';
import { ContentTypeChip } from '../../../shared/components/ContentTypeChip';
import { FavoriteToggleButton } from '../../../shared/components/FavoriteToggleButton';
import { TagChipList } from '../../../shared/components/TagChipList';
import type { BookmarkFormValues } from '../hooks/useBookmarkDetail';
import { BOOKMARK_DETAIL_STRINGS } from '../strings';

export interface BookmarkDetailFormProps {
  bookmark: Bookmark;
  form: BookmarkFormValues;
  fieldErrors: Partial<Record<keyof BookmarkFormValues, string>>;
  saveError: string | null;
  saving: boolean;
  isDirty: boolean;
  onFieldChange: (field: keyof BookmarkFormValues, value: string) => void;
  onReset: () => void;
  onSave: () => Promise<boolean>;
  onToggleFavorite: () => void;
  onTrash: () => void;
  onRestore: () => void;
}

export function BookmarkDetailForm({
  bookmark,
  form,
  fieldErrors,
  saveError,
  saving,
  isDirty,
  onFieldChange,
  onReset,
  onSave,
  onToggleFavorite,
  onTrash,
  onRestore,
}: BookmarkDetailFormProps) {
  const isTrashed = bookmark.deletedAt !== null;
  const isFile = bookmark.storageKind === 'file';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave();
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack spacing={2.5}>
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <BookmarkIconBadge
              iconRef={bookmark.iconRef}
              contentType={bookmark.contentType}
              alt={bookmark.title ?? ''}
              size={40}
            />
            <Box sx={{ minWidth: 0 }}>
              <ContentTypeChip contentType={bookmark.contentType} />
              {bookmark.urlParts?.host ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: 'block', mt: 0.5 }}
                >
                  {bookmark.urlParts.host}
                </Typography>
              ) : bookmark.fileName ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ display: 'block', mt: 0.5 }}
                >
                  {bookmark.fileName}
                </Typography>
              ) : null}
            </Box>
          </Stack>

          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <FavoriteToggleButton
              favorite={bookmark.favorite}
              disabled={saving || isTrashed}
              itemLabel={bookmark.title ?? undefined}
              size="medium"
              onToggle={onToggleFavorite}
            />
            {bookmark.url ? (
              <Button
                component="a"
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                variant="outlined"
                endIcon={<OpenInNewOutlinedIcon fontSize="small" />}
              >
                {BOOKMARK_DETAIL_STRINGS.openOriginalLabel}
              </Button>
            ) : null}
          </Stack>
        </Stack>

        {isTrashed ? (
          <Alert
            severity="warning"
            action={
              <Button
                color="inherit"
                size="small"
                startIcon={<RestoreFromTrashOutlinedIcon />}
                onClick={onRestore}
                disabled={saving}
              >
                {BOOKMARK_DETAIL_STRINGS.restoreLabel}
              </Button>
            }
          >
            {BOOKMARK_DETAIL_STRINGS.trashedNotice}
          </Alert>
        ) : null}

        {saveError ? <Alert severity="error">{saveError}</Alert> : null}

        <TextField
          label={BOOKMARK_DETAIL_STRINGS.titleLabel}
          value={form.title}
          onChange={(e) => onFieldChange('title', e.target.value)}
          error={Boolean(fieldErrors.title)}
          helperText={fieldErrors.title}
          disabled={saving || isTrashed}
          fullWidth
        />

        <TextField
          label={BOOKMARK_DETAIL_STRINGS.urlLabel}
          value={form.url}
          onChange={(e) => onFieldChange('url', e.target.value)}
          error={Boolean(fieldErrors.url)}
          helperText={
            fieldErrors.url ?? (isFile ? BOOKMARK_DETAIL_STRINGS.fileUrlReadonlyHint : undefined)
          }
          disabled={saving || isTrashed || isFile}
          fullWidth
        />

        <TextField
          label={BOOKMARK_DETAIL_STRINGS.excerptLabel}
          value={form.excerpt}
          onChange={(e) => onFieldChange('excerpt', e.target.value)}
          error={Boolean(fieldErrors.excerpt)}
          helperText={fieldErrors.excerpt}
          disabled={saving || isTrashed}
          multiline
          minRows={2}
          fullWidth
        />

        <TextField
          label={BOOKMARK_DETAIL_STRINGS.noteLabel}
          value={form.note}
          onChange={(e) => onFieldChange('note', e.target.value)}
          error={Boolean(fieldErrors.note)}
          helperText={fieldErrors.note}
          disabled={saving || isTrashed}
          multiline
          minRows={4}
          fullWidth
        />

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            {BOOKMARK_DETAIL_STRINGS.tagsLabel}
          </Typography>
          {bookmark.tags.length > 0 ? (
            <TagChipList tags={bookmark.tags} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {BOOKMARK_DETAIL_STRINGS.noTagsLabel}
            </Typography>
          )}
        </Box>

        <Divider />

        <Stack
          direction="row"
          spacing={1.5}
          sx={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
        >
          {!isTrashed ? (
            <Button
              color="error"
              variant="outlined"
              startIcon={<DeleteOutlineOutlinedIcon />}
              onClick={onTrash}
              disabled={saving}
            >
              {BOOKMARK_DETAIL_STRINGS.moveToTrashLabel}
            </Button>
          ) : (
            <Box />
          )}

          <Stack direction="row" spacing={1}>
            {isDirty ? (
              <Button variant="text" onClick={onReset} disabled={saving}>
                {BOOKMARK_DETAIL_STRINGS.resetChangesLabel}
              </Button>
            ) : null}
            <Button type="submit" variant="contained" disabled={saving || isTrashed || !isDirty}>
              {saving
                ? BOOKMARK_DETAIL_STRINGS.savingLabel
                : BOOKMARK_DETAIL_STRINGS.saveChangesLabel}
            </Button>
          </Stack>
        </Stack>

        <Stack spacing={0.25}>
          <Typography variant="caption" color="text.secondary">
            {`${BOOKMARK_DETAIL_STRINGS.createdPrefix}: ${new Date(bookmark.createdAt).toLocaleString()}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {`${BOOKMARK_DETAIL_STRINGS.updatedPrefix}: ${new Date(bookmark.updatedAt).toLocaleString()}`}
          </Typography>
        </Stack>
      </Stack>
    </Box>
  );
}
