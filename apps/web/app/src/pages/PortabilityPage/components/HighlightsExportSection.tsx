import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { Bookmark } from '../../../api/schemas/bookmarks';
import type { HighlightsExportFormat } from '../../../api/schemas/portability';
import { SHARED_BOOKMARK_STRINGS } from '../../../shared/strings';
import { PORTABILITY_PAGE_STRINGS } from '../strings';

export interface HighlightsExportSectionProps {
  bookmarks: Bookmark[];
  exporting: boolean;
  error: string | null;
  onExport: (bookmarkId: string, format: HighlightsExportFormat) => Promise<boolean>;
}

export function HighlightsExportSection({
  bookmarks,
  exporting,
  error,
  onExport,
}: HighlightsExportSectionProps) {
  const [selectedId, setSelectedId] = useState<string>('');

  const effectiveId =
    selectedId && bookmarks.some((b) => b.id === selectedId)
      ? selectedId
      : (bookmarks[0]?.id ?? '');

  return (
    <Paper variant="outlined" sx={{ p: 3 }} data-testid="portability-highlights-section">
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6" component="h2">
            {PORTABILITY_PAGE_STRINGS.highlightsHeading}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {PORTABILITY_PAGE_STRINGS.highlightsDescription}
          </Typography>
        </Box>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' } }}
        >
          <FormControl size="small" sx={{ minWidth: 260, flexGrow: 1 }}>
            <InputLabel id="highlights-export-bookmark-label">
              {PORTABILITY_PAGE_STRINGS.highlightsSelectLabel}
            </InputLabel>
            <Select
              labelId="highlights-export-bookmark-label"
              label={PORTABILITY_PAGE_STRINGS.highlightsSelectLabel}
              value={effectiveId}
              disabled={exporting || bookmarks.length === 0}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {bookmarks.length === 0 ? (
                <MenuItem value="">{PORTABILITY_PAGE_STRINGS.highlightsEmptyOption}</MenuItem>
              ) : (
                bookmarks.map((bm) => (
                  <MenuItem key={bm.id} value={bm.id}>
                    {bm.title ?? bm.fileName ?? bm.url ?? SHARED_BOOKMARK_STRINGS.untitledBookmark}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>

          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button
              variant="outlined"
              startIcon={<DownloadOutlinedIcon fontSize="small" />}
              disabled={!effectiveId || exporting}
              onClick={() => void onExport(effectiveId, 'txt')}
            >
              {PORTABILITY_PAGE_STRINGS.highlightsExportTxtLabel}
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadOutlinedIcon fontSize="small" />}
              disabled={!effectiveId || exporting}
              onClick={() => void onExport(effectiveId, 'csv')}
            >
              {PORTABILITY_PAGE_STRINGS.highlightsExportCsvLabel}
            </Button>
          </Stack>
        </Stack>

        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </Paper>
  );
}
