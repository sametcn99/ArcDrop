import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';
import { useState } from 'react';
import {
  createHighlightRequestSchema,
  updateHighlightRequestSchema,
  type CreateHighlightRequest,
  type Highlight,
  type UpdateHighlightRequest,
} from '../../../api/schemas/bookmarks';
import { BOOKMARK_DETAIL_STRINGS } from '../strings';

const HIGHLIGHT_COLORS = [
  { value: '', label: BOOKMARK_DETAIL_STRINGS.highlightColorDefault },
  { value: 'amber', label: BOOKMARK_DETAIL_STRINGS.highlightColorAmber },
  { value: 'mint', label: BOOKMARK_DETAIL_STRINGS.highlightColorMint },
  { value: 'sky', label: BOOKMARK_DETAIL_STRINGS.highlightColorSky },
  { value: 'rose', label: BOOKMARK_DETAIL_STRINGS.highlightColorRose },
] as const;

export interface HighlightsSectionProps {
  highlights: Highlight[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  isTrashed: boolean;
  onCreate: (input: CreateHighlightRequest) => Promise<boolean>;
  onUpdate: (highlightId: string, input: UpdateHighlightRequest) => Promise<boolean>;
  onDelete: (highlightId: string) => Promise<boolean>;
}

export function HighlightsSection({
  highlights,
  loading,
  busy,
  error,
  isTrashed,
  onCreate,
  onUpdate,
  onDelete,
}: HighlightsSectionProps) {
  const theme = useTheme();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createText, setCreateText] = useState('');
  const [createNote, setCreateNote] = useState('');
  const [createColor, setCreateColor] = useState('');
  const [createValidationError, setCreateValidationError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editValidationError, setEditValidationError] = useState<string | null>(null);

  const resolveColorSx = (colorName: string | null) => {
    const normalized = (colorName ?? '').trim().toLowerCase();
    let paletteColor: string | null = null;
    if (normalized === 'amber' || normalized === 'yellow') {
      paletteColor = theme.palette.warning.main;
    } else if (normalized === 'mint' || normalized === 'green') {
      paletteColor = theme.palette.success.main;
    } else if (normalized === 'sky' || normalized === 'blue') {
      paletteColor = theme.palette.info.main;
    } else if (normalized === 'rose' || normalized === 'red' || normalized === 'pink') {
      paletteColor = theme.palette.error.main;
    }

    if (!paletteColor) {
      return {
        borderLeftWidth: 3,
        borderLeftColor: 'divider',
      };
    }

    return {
      borderLeftWidth: 4,
      borderLeftColor: paletteColor,
      bgcolor: alpha(paletteColor, 0.08),
    };
  };

  const handleCreateSubmit = async () => {
    if (busy || isTrashed) return;
    setCreateValidationError(null);
    const parsed = createHighlightRequestSchema.safeParse({
      text: createText,
      note: createNote.trim() ? createNote.trim() : null,
      color: createColor || null,
    });
    if (!parsed.success) {
      setCreateValidationError(parsed.error.issues[0]?.message ?? 'Highlight text is required.');
      return;
    }

    const ok = await onCreate(parsed.data);
    if (ok) {
      setCreateText('');
      setCreateNote('');
      setCreateColor('');
      setShowCreateForm(false);
    }
  };

  const handleStartEdit = (item: Highlight) => {
    setEditingId(item.id);
    setEditText(item.text);
    setEditNote(item.note ?? '');
    setEditColor(item.color ?? '');
    setEditValidationError(null);
  };

  const handleEditSubmit = async () => {
    if (!editingId || busy || isTrashed) return;
    setEditValidationError(null);
    const parsed = updateHighlightRequestSchema.safeParse({
      text: editText,
      note: editNote.trim() ? editNote.trim() : null,
      color: editColor || null,
    });
    if (!parsed.success) {
      setEditValidationError(parsed.error.issues[0]?.message ?? 'Highlight text is required.');
      return;
    }

    const ok = await onUpdate(editingId, parsed.data);
    if (ok) {
      setEditingId(null);
    }
  };

  return (
    <Stack spacing={1.5} data-testid="bookmark-highlights-section">
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2">{BOOKMARK_DETAIL_STRINGS.highlightsHeading}</Typography>
        {!isTrashed && !showCreateForm ? (
          <Button
            size="small"
            startIcon={<AddOutlinedIcon fontSize="small" />}
            disabled={busy}
            onClick={() => {
              setShowCreateForm(true);
              setCreateValidationError(null);
            }}
          >
            {BOOKMARK_DETAIL_STRINGS.highlightAddLabel}
          </Button>
        ) : null}
      </Stack>

      {isTrashed ? (
        <Alert severity="info">{BOOKMARK_DETAIL_STRINGS.highlightsTrashedNotice}</Alert>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}

      {showCreateForm && !isTrashed ? (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Stack spacing={1.5}>
            <TextField
              size="small"
              label={BOOKMARK_DETAIL_STRINGS.highlightTextLabel}
              value={createText}
              onChange={(e) => {
                setCreateText(e.target.value);
                setCreateValidationError(null);
              }}
              error={Boolean(createValidationError)}
              helperText={createValidationError}
              disabled={busy}
              multiline
              minRows={2}
              fullWidth
            />
            <TextField
              size="small"
              label={BOOKMARK_DETAIL_STRINGS.highlightNoteLabel}
              value={createNote}
              onChange={(e) => setCreateNote(e.target.value)}
              disabled={busy}
              fullWidth
            />
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary">
                {BOOKMARK_DETAIL_STRINGS.highlightColorLabel}
              </Typography>
              {HIGHLIGHT_COLORS.map((option) => (
                <Chip
                  key={option.value || 'default'}
                  size="small"
                  label={option.label}
                  variant={createColor === option.value ? 'filled' : 'outlined'}
                  color={createColor === option.value ? 'primary' : 'default'}
                  disabled={busy}
                  onClick={() => setCreateColor(option.value)}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button
                size="small"
                disabled={busy}
                onClick={() => {
                  setShowCreateForm(false);
                  setCreateValidationError(null);
                }}
              >
                {BOOKMARK_DETAIL_STRINGS.highlightCancelLabel}
              </Button>
              <Button
                size="small"
                variant="contained"
                disabled={busy}
                onClick={() => void handleCreateSubmit()}
              >
                {BOOKMARK_DETAIL_STRINGS.highlightCreateSubmitLabel}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ) : null}

      {loading && highlights.length === 0 ? (
        <Stack spacing={1} aria-label={BOOKMARK_DETAIL_STRINGS.highlightsLoading}>
          <Skeleton variant="rounded" height={56} />
        </Stack>
      ) : highlights.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {BOOKMARK_DETAIL_STRINGS.highlightsEmpty}
        </Typography>
      ) : (
        <Stack spacing={1.25}>
          {highlights.map((item) => {
            const isEditing = editingId === item.id;
            return (
              <Paper
                key={item.id}
                variant="outlined"
                data-testid={`highlight-item-${item.id}`}
                sx={{ p: 1.5, ...resolveColorSx(item.color) }}
              >
                {isEditing && !isTrashed ? (
                  <Stack spacing={1.25}>
                    <TextField
                      size="small"
                      label={BOOKMARK_DETAIL_STRINGS.highlightTextLabel}
                      value={editText}
                      onChange={(e) => {
                        setEditText(e.target.value);
                        setEditValidationError(null);
                      }}
                      error={Boolean(editValidationError)}
                      helperText={editValidationError}
                      disabled={busy}
                      multiline
                      minRows={2}
                      fullWidth
                    />
                    <TextField
                      size="small"
                      label={BOOKMARK_DETAIL_STRINGS.highlightNoteLabel}
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      disabled={busy}
                      fullWidth
                    />
                    <Stack
                      direction="row"
                      spacing={0.75}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        {BOOKMARK_DETAIL_STRINGS.highlightColorLabel}
                      </Typography>
                      {HIGHLIGHT_COLORS.map((option) => (
                        <Chip
                          key={option.value || 'default'}
                          size="small"
                          label={option.label}
                          variant={editColor === option.value ? 'filled' : 'outlined'}
                          color={editColor === option.value ? 'primary' : 'default'}
                          disabled={busy}
                          onClick={() => setEditColor(option.value)}
                        />
                      ))}
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        disabled={busy}
                        onClick={() => {
                          setEditingId(null);
                          setEditValidationError(null);
                        }}
                      >
                        {BOOKMARK_DETAIL_STRINGS.highlightCancelLabel}
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={busy}
                        onClick={() => void handleEditSubmit()}
                      >
                        {BOOKMARK_DETAIL_STRINGS.highlightUpdateSubmitLabel}
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Stack spacing={0.75}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
                    >
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {item.text}
                      </Typography>
                      {!isTrashed ? (
                        <Box sx={{ display: 'flex', flexShrink: 0 }}>
                          <Tooltip title={BOOKMARK_DETAIL_STRINGS.highlightEditLabel}>
                            <IconButton
                              size="small"
                              aria-label={`${BOOKMARK_DETAIL_STRINGS.highlightEditLabel} ${item.id}`}
                              disabled={busy}
                              onClick={() => handleStartEdit(item)}
                            >
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={BOOKMARK_DETAIL_STRINGS.highlightDeleteLabel}>
                            <IconButton
                              size="small"
                              color="error"
                              aria-label={`${BOOKMARK_DETAIL_STRINGS.highlightDeleteLabel} ${item.id}`}
                              disabled={busy}
                              onClick={() => void onDelete(item.id)}
                            >
                              <DeleteOutlineOutlinedIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      ) : null}
                    </Stack>
                    {item.note ? (
                      <Typography variant="caption" color="text.secondary">
                        {item.note}
                      </Typography>
                    ) : null}
                  </Stack>
                )}
              </Paper>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
