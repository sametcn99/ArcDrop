import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ExportDialog } from './components/ExportDialog';
import { HighlightsExportSection } from './components/HighlightsExportSection';
import { ImportSection } from './components/ImportSection';
import { usePortability } from './hooks/usePortability';
import { PORTABILITY_PAGE_STRINGS } from './strings';

export default function PortabilityPage() {
  const {
    activeBookmarks,
    importing,
    importSummary,
    importError,
    importBusyConflict,
    clearImportFeedback,
    runImport,
    exporting,
    exportError,
    clearExportError,
    runExport,
    exportingHighlights,
    highlightsError,
    runHighlightsExport,
  } = usePortability();

  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1">
          {PORTABILITY_PAGE_STRINGS.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {PORTABILITY_PAGE_STRINGS.subtitle}
        </Typography>
      </Box>

      <ImportSection
        importing={importing}
        summary={importSummary}
        error={importError}
        busyConflict={importBusyConflict}
        onClearFeedback={clearImportFeedback}
        onImportFile={runImport}
      />

      <Paper variant="outlined" sx={{ p: 3 }} data-testid="portability-export-section">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h6" component="h2">
              {PORTABILITY_PAGE_STRINGS.exportHeading}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {PORTABILITY_PAGE_STRINGS.exportDescription}
            </Typography>
          </Box>

          <Button
            variant="contained"
            startIcon={<DownloadOutlinedIcon fontSize="small" />}
            sx={{ flexShrink: 0 }}
            onClick={() => {
              clearExportError();
              setExportDialogOpen(true);
            }}
          >
            {PORTABILITY_PAGE_STRINGS.exportOpenDialogLabel}
          </Button>
        </Stack>
      </Paper>

      <HighlightsExportSection
        bookmarks={activeBookmarks}
        exporting={exportingHighlights}
        error={highlightsError}
        onExport={runHighlightsExport}
      />

      <ExportDialog
        open={exportDialogOpen}
        exporting={exporting}
        error={exportError}
        onClose={() => setExportDialogOpen(false)}
        onSubmit={runExport}
      />
    </Stack>
  );
}
