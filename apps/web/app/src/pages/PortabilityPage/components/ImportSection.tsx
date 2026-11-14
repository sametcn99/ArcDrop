import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import type { ImportSummary } from '../../../api/schemas/portability';
import { PORTABILITY_PAGE_STRINGS } from '../strings';

const IMPORT_ACCEPT_EXTENSIONS = '.json,.csv,.html,.htm,.txt,.enex,.zip';

export interface ImportSectionProps {
  importing: boolean;
  summary: ImportSummary | null;
  error: string | null;
  busyConflict: string | null;
  onClearFeedback: () => void;
  onImportFile: (file: File) => Promise<ImportSummary | null>;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportSection({
  importing,
  summary,
  error,
  busyConflict,
  onClearFeedback,
  onImportFile,
}: ImportSectionProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleSelectFile = (file: File | null) => {
    setSelectedFile(file);
    onClearFeedback();
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    handleSelectFile(file);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    if (importing) return;
    const file = event.dataTransfer.files?.[0] ?? null;
    if (file) {
      handleSelectFile(file);
    }
  };

  const issueRows = summary
    ? [
        ...summary.skipped.map((entry, idx) => ({
          key: `skipped-${idx}`,
          kind: 'skipped' as const,
          source: entry.source,
          reason: entry.reason,
        })),
        ...summary.errors.map((entry, idx) => ({
          key: `error-${idx}`,
          kind: 'error' as const,
          source: entry.source,
          reason: entry.reason,
        })),
      ]
    : [];

  return (
    <Paper variant="outlined" sx={{ p: 3 }} data-testid="portability-import-section">
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h6" component="h2">
            {PORTABILITY_PAGE_STRINGS.importHeading}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {PORTABILITY_PAGE_STRINGS.importDescription}
          </Typography>
        </Box>

        <Paper
          variant="outlined"
          data-testid="import-dropzone"
          onDragOver={(event) => {
            event.preventDefault();
            if (!importing) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          sx={{
            p: 3,
            textAlign: 'center',
            borderStyle: 'dashed',
            borderColor: dragOver ? 'primary.main' : 'divider',
            bgcolor: dragOver ? 'action.hover' : 'background.default',
          }}
        >
          <Box
            component="input"
            ref={inputRef}
            type="file"
            accept={IMPORT_ACCEPT_EXTENSIONS}
            aria-label={PORTABILITY_PAGE_STRINGS.importFileInputLabel}
            data-testid="import-file-input"
            onChange={handleInputChange}
            sx={{ display: 'none' }}
          />

          <Stack spacing={1.25} sx={{ alignItems: 'center' }}>
            <CloudUploadOutlinedIcon color="primary" fontSize="large" />
            <Typography variant="subtitle2">
              {dragOver
                ? PORTABILITY_PAGE_STRINGS.importDropzoneActiveTitle
                : PORTABILITY_PAGE_STRINGS.importDropzoneTitle}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {PORTABILITY_PAGE_STRINGS.importFormatsHint}
            </Typography>

            {selectedFile ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', pt: 0.5 }}
              >
                <Chip
                  icon={<InsertDriveFileOutlinedIcon fontSize="small" />}
                  label={`${selectedFile.name} (${formatByteSize(selectedFile.size)})`}
                  variant="outlined"
                />
                <Button size="small" disabled={importing} onClick={() => inputRef.current?.click()}>
                  {PORTABILITY_PAGE_STRINGS.importChangeFileLabel}
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  disabled={importing}
                  onClick={() => handleSelectFile(null)}
                >
                  {PORTABILITY_PAGE_STRINGS.importClearFileLabel}
                </Button>
              </Stack>
            ) : (
              <Button
                variant="outlined"
                disabled={importing}
                onClick={() => inputRef.current?.click()}
              >
                {PORTABILITY_PAGE_STRINGS.importChooseFileLabel}
              </Button>
            )}
          </Stack>
        </Paper>

        {importing ? (
          <Stack spacing={0.75} data-testid="import-progress">
            <Typography variant="caption" color="text.secondary">
              {PORTABILITY_PAGE_STRINGS.importUploadingLabel}
            </Typography>
            <LinearProgress aria-label={PORTABILITY_PAGE_STRINGS.importUploadingLabel} />
          </Stack>
        ) : null}

        {busyConflict ? (
          <Alert
            severity="warning"
            data-testid="import-busy-alert"
            action={
              selectedFile ? (
                <Button
                  color="inherit"
                  size="small"
                  disabled={importing}
                  onClick={() => void onImportFile(selectedFile)}
                >
                  {PORTABILITY_PAGE_STRINGS.importRetryLabel}
                </Button>
              ) : undefined
            }
          >
            <Typography variant="subtitle2">{PORTABILITY_PAGE_STRINGS.importBusyTitle}</Typography>
            <Typography variant="body2">{busyConflict}</Typography>
          </Alert>
        ) : null}

        {error ? (
          <Alert severity="error" data-testid="import-error-alert">
            {error}
          </Alert>
        ) : null}

        {summary ? (
          <Stack spacing={2} data-testid="import-summary-panel">
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
            >
              <Typography variant="subtitle2" sx={{ mr: 1 }}>
                {PORTABILITY_PAGE_STRINGS.importSummaryTitle}
              </Typography>
              <Chip
                size="small"
                color="success"
                label={`${PORTABILITY_PAGE_STRINGS.importCreatedLabel}: ${summary.created}`}
              />
              <Chip
                size="small"
                color="info"
                label={`${PORTABILITY_PAGE_STRINGS.importUpdatedLabel}: ${summary.updated}`}
              />
              <Chip
                size="small"
                color={summary.skipped.length > 0 ? 'warning' : 'default'}
                variant="outlined"
                label={`${PORTABILITY_PAGE_STRINGS.importSkippedLabel}: ${summary.skipped.length}`}
              />
              <Chip
                size="small"
                color={summary.errors.length > 0 ? 'error' : 'default'}
                variant="outlined"
                label={`${PORTABILITY_PAGE_STRINGS.importErrorsLabel}: ${summary.errors.length}`}
              />
            </Stack>

            {issueRows.length === 0 ? (
              <Alert severity="success">{PORTABILITY_PAGE_STRINGS.importNoIssuesMessage}</Alert>
            ) : (
              <TableContainer component={Paper} variant="outlined">
                <Table
                  size="small"
                  aria-label={PORTABILITY_PAGE_STRINGS.importTableAriaLabel}
                  data-testid="import-summary-table"
                >
                  <TableHead>
                    <TableRow>
                      <TableCell>{PORTABILITY_PAGE_STRINGS.importColType}</TableCell>
                      <TableCell>{PORTABILITY_PAGE_STRINGS.importColSource}</TableCell>
                      <TableCell>{PORTABILITY_PAGE_STRINGS.importColReason}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {issueRows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <Chip
                            size="small"
                            color={row.kind === 'error' ? 'error' : 'warning'}
                            variant="outlined"
                            label={
                              row.kind === 'error'
                                ? PORTABILITY_PAGE_STRINGS.importTypeError
                                : PORTABILITY_PAGE_STRINGS.importTypeSkipped
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                            {row.source ?? PORTABILITY_PAGE_STRINGS.importUnknownSource}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{row.reason}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Stack>
        ) : null}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="contained"
            startIcon={<CloudUploadOutlinedIcon fontSize="small" />}
            disabled={!selectedFile || importing}
            onClick={() => {
              if (selectedFile) {
                void onImportFile(selectedFile);
              }
            }}
          >
            {importing
              ? PORTABILITY_PAGE_STRINGS.importUploadingLabel
              : PORTABILITY_PAGE_STRINGS.importStartLabel}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}
