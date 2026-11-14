import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { lazy, Suspense, useState } from 'react';
import { BOOKMARK_DETAIL_STRINGS } from '../strings';

// react-markdown + micromark weigh ~30% of the BookmarkDetail chunk; the
// preview tab is optional, so load it on first use instead of eagerly.
const MarkdownPreview = lazy(() =>
  import('../../../shared/components/MarkdownPreview').then((m) => ({
    default: m.MarkdownPreview,
  })),
);

export interface MarkdownNoteEditorProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
}

export function MarkdownNoteEditor({
  value,
  onChange,
  error,
  disabled = false,
}: MarkdownNoteEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  return (
    <Stack spacing={1}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {BOOKMARK_DETAIL_STRINGS.noteMarkdownHint}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_event, nextMode: 'edit' | 'preview' | null) => {
            if (nextMode) setMode(nextMode);
          }}
          aria-label="Note editor mode"
        >
          <ToggleButton value="edit" aria-label={BOOKMARK_DETAIL_STRINGS.noteEditTabLabel}>
            <EditOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />
            {BOOKMARK_DETAIL_STRINGS.noteEditTabLabel}
          </ToggleButton>
          <ToggleButton value="preview" aria-label={BOOKMARK_DETAIL_STRINGS.notePreviewTabLabel}>
            <VisibilityOutlinedIcon fontSize="small" sx={{ mr: 0.5 }} />
            {BOOKMARK_DETAIL_STRINGS.notePreviewTabLabel}
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {mode === 'edit' ? (
        <TextField
          label={BOOKMARK_DETAIL_STRINGS.noteLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          error={Boolean(error)}
          helperText={error}
          disabled={disabled}
          multiline
          minRows={4}
          fullWidth
        />
      ) : (
        <Paper variant="outlined" sx={{ p: 1.5, minHeight: 112 }}>
          {value.trim().length > 0 ? (
            <Suspense fallback={<Typography variant="body2">Loading preview…</Typography>}>
              <MarkdownPreview markdown={value} />
            </Suspense>
          ) : (
            <Box sx={{ py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {BOOKMARK_DETAIL_STRINGS.noteEmptyPreview}
              </Typography>
            </Box>
          )}
        </Paper>
      )}
    </Stack>
  );
}
