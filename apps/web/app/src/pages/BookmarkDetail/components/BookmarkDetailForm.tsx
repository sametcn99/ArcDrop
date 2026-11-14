import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import RestoreFromTrashOutlinedIcon from '@mui/icons-material/RestoreFromTrashOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState, type FormEvent } from 'react';
import type {
  Bookmark,
  CreateHighlightRequest,
  Highlight,
  UpdateHighlightRequest,
} from '../../../api/schemas/bookmarks';
import { AuthenticatedFilePreview } from '../../../shared/components/AuthenticatedFilePreview';
import { BookmarkIconBadge } from '../../../shared/components/BookmarkIconBadge';
import { CacheStatusChip } from '../../../shared/components/CacheStatusChip';
import { ContentTypeChip } from '../../../shared/components/ContentTypeChip';
import { FavoriteToggleButton } from '../../../shared/components/FavoriteToggleButton';
import { TagAutocompleteInput } from '../../../shared/components/TagAutocompleteInput';
import {
  formatFileSize,
  isExtractableTextFileBookmark,
  isImageFileBookmark,
} from '../../../shared/utils/fileFormat';
import type { BookmarkFormValues } from '../hooks/useBookmarkDetail';
import { BOOKMARK_DETAIL_STRINGS } from '../strings';
import { HighlightsSection } from './HighlightsSection';
import { MarkdownNoteEditor } from './MarkdownNoteEditor';
import { ReminderSection } from './ReminderSection';

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
  tagsSaving: boolean;
  tagsError: string | null;
  onSaveTags: (tags: string[]) => Promise<boolean>;
  reminderSaving: boolean;
  reminderError: string | null;
  onSaveReminder: (reminderAt: string | null) => Promise<boolean>;
  highlights: Highlight[];
  highlightsLoading: boolean;
  highlightsBusy: boolean;
  highlightsError: string | null;
  onCreateHighlight: (input: CreateHighlightRequest) => Promise<boolean>;
  onUpdateHighlight: (highlightId: string, input: UpdateHighlightRequest) => Promise<boolean>;
  onDeleteHighlight: (highlightId: string) => Promise<boolean>;
  onToggleFavorite: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDownloadFile?: () => void;
  onOpenArchiveText?: () => void;
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
  tagsSaving,
  tagsError,
  onSaveTags,
  reminderSaving,
  reminderError,
  onSaveReminder,
  highlights,
  highlightsLoading,
  highlightsBusy,
  highlightsError,
  onCreateHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
  onToggleFavorite,
  onTrash,
  onRestore,
  onDownloadFile,
  onOpenArchiveText,
}: BookmarkDetailFormProps) {
  const isTrashed = bookmark.deletedAt !== null;
  const isFile = bookmark.storageKind === 'file';
  const isImageFile = isImageFileBookmark(bookmark);
  const isExtractableText = isExtractableTextFileBookmark(bookmark);

  const currentTagNames = useMemo(() => bookmark.tags.map((tag) => tag.name), [bookmark.tags]);
  const tagSyncKey = `${bookmark.id}|${currentTagNames.join('\0')}`;
  const [tagDraftState, setTagDraftState] = useState<{
    syncKey: string;
    tags: string[];
  } | null>(null);

  const tagDraft =
    tagDraftState && tagDraftState.syncKey === tagSyncKey ? tagDraftState.tags : currentTagNames;

  const tagsDirty =
    tagDraft.length !== currentTagNames.length ||
    tagDraft.some((tag, idx) => tag !== currentTagNames[idx]);

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
          sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
            <BookmarkIconBadge
              iconRef={bookmark.iconRef}
              contentType={bookmark.contentType}
              alt={bookmark.title ?? ''}
              size={40}
            />
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <ContentTypeChip contentType={bookmark.contentType} />
                <CacheStatusChip status={bookmark.cacheStatus} />
              </Stack>
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
            {isFile && onDownloadFile ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadOutlinedIcon fontSize="small" />}
                onClick={onDownloadFile}
              >
                {BOOKMARK_DETAIL_STRINGS.downloadFileLabel}
              </Button>
            ) : bookmark.url ? (
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

        {isFile ? (
          <Paper
            variant="outlined"
            data-testid="bookmark-file-section"
            sx={{ p: 2, bgcolor: 'background.default' }}
          >
            <Stack spacing={1.5}>
              <Typography variant="subtitle2">
                {BOOKMARK_DETAIL_STRINGS.fileSectionHeading}
              </Typography>

              {isImageFile ? (
                <AuthenticatedFilePreview
                  bookmarkId={bookmark.id}
                  contentType={bookmark.contentType}
                  alt={bookmark.title ?? bookmark.fileName ?? ''}
                  variant="banner"
                  maxHeight={240}
                />
              ) : null}

              <Stack spacing={0.25}>
                {bookmark.fileName ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${BOOKMARK_DETAIL_STRINGS.fileNameLabel}: ${bookmark.fileName}`}
                  </Typography>
                ) : null}
                {bookmark.fileMime ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${BOOKMARK_DETAIL_STRINGS.fileMimeLabel}: ${bookmark.fileMime}`}
                  </Typography>
                ) : null}
                {bookmark.fileSize !== null ? (
                  <Typography variant="caption" color="text.secondary">
                    {`${BOOKMARK_DETAIL_STRINGS.fileSizeLabel}: ${formatFileSize(bookmark.fileSize)}`}
                  </Typography>
                ) : null}
              </Stack>

              {isExtractableText && onOpenArchiveText ? (
                <Box>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<DescriptionOutlinedIcon fontSize="small" />}
                    onClick={onOpenArchiveText}
                  >
                    {BOOKMARK_DETAIL_STRINGS.readArchiveTextLabel}
                  </Button>
                </Box>
              ) : null}
            </Stack>
          </Paper>
        ) : null}

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

        <MarkdownNoteEditor
          value={form.note}
          onChange={(nextNote) => onFieldChange('note', nextNote)}
          error={fieldErrors.note}
          disabled={saving || isTrashed}
        />

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

        <Divider />

        <Stack spacing={1.25} data-testid="bookmark-tags-section">
          <Typography variant="subtitle2">{BOOKMARK_DETAIL_STRINGS.tagsLabel}</Typography>
          {tagsError ? <Alert severity="error">{tagsError}</Alert> : null}
          <TagAutocompleteInput
            value={tagDraft}
            onChange={(nextTags) => setTagDraftState({ syncKey: tagSyncKey, tags: nextTags })}
            disabled={tagsSaving || isTrashed}
            helperText={isTrashed ? BOOKMARK_DETAIL_STRINGS.tagsTrashedHint : undefined}
          />
          {!isTrashed ? (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="outlined"
                disabled={tagsSaving || !tagsDirty}
                onClick={() => {
                  void onSaveTags(tagDraft).then((ok) => {
                    if (ok) setTagDraftState(null);
                  });
                }}
              >
                {tagsSaving
                  ? BOOKMARK_DETAIL_STRINGS.tagsSavingLabel
                  : BOOKMARK_DETAIL_STRINGS.tagsSaveLabel}
              </Button>
              {tagsDirty ? (
                <Button size="small" disabled={tagsSaving} onClick={() => setTagDraftState(null)}>
                  {BOOKMARK_DETAIL_STRINGS.tagsResetLabel}
                </Button>
              ) : null}
            </Stack>
          ) : null}
        </Stack>

        <Divider />

        <ReminderSection
          reminderAt={bookmark.reminderAt}
          remindedAt={bookmark.remindedAt}
          busy={reminderSaving}
          error={reminderError}
          isTrashed={isTrashed}
          onSaveReminder={onSaveReminder}
        />

        <Divider />

        <HighlightsSection
          highlights={highlights}
          loading={highlightsLoading}
          busy={highlightsBusy}
          error={highlightsError}
          isTrashed={isTrashed}
          onCreate={onCreateHighlight}
          onUpdate={onUpdateHighlight}
          onDelete={onDeleteHighlight}
        />

        <Divider />

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
