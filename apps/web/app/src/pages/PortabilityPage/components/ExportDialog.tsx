import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import { useMemo, useState } from 'react';
import type { ExportDataRequest, ExportFormat } from '../../../api/schemas/portability';
import { selectSortedCollections, useLibraryStore } from '../../../stores/libraryStore';
import { PORTABILITY_PAGE_STRINGS } from '../strings';

export interface ExportDialogProps {
  open: boolean;
  exporting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: ExportDataRequest) => Promise<boolean>;
}

const EXPORT_FORMATS: ExportFormat[] = ['json', 'csv', 'html', 'txt'];

export function ExportDialog({
  open,
  exporting,
  error,
  onClose,
  onSubmit,
}: ExportDialogProps) {
  const collectionsById = useLibraryStore((s) => s.collectionsById);
  const collections = useMemo(
    () =>
      selectSortedCollections({ collectionsById } as Parameters<typeof selectSortedCollections>[0]),
    [collectionsById],
  );

  const [format, setFormat] = useState<ExportFormat>('json');
  const [collectionId, setCollectionId] = useState<string>('');
  const [includeFiles, setIncludeFiles] = useState(false);

  const handleSubmit = async () => {
    const ok = await onSubmit({
      format,
      collectionId: collectionId || undefined,
      includeFiles,
    });
    if (ok) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => (!exporting ? onClose() : undefined)}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>{PORTABILITY_PAGE_STRINGS.exportDialogTitle}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="export-format-label">
              {PORTABILITY_PAGE_STRINGS.exportFormatLabel}
            </InputLabel>
            <Select
              labelId="export-format-label"
              label={PORTABILITY_PAGE_STRINGS.exportFormatLabel}
              value={format}
              disabled={exporting}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              {EXPORT_FORMATS.map((fmt) => (
                <MenuItem key={fmt} value={fmt}>
                  {PORTABILITY_PAGE_STRINGS.exportFormatOptions[fmt]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel id="export-scope-label">
              {PORTABILITY_PAGE_STRINGS.exportScopeLabel}
            </InputLabel>
            <Select
              labelId="export-scope-label"
              label={PORTABILITY_PAGE_STRINGS.exportScopeLabel}
              value={collectionId}
              disabled={exporting}
              onChange={(e) => setCollectionId(e.target.value)}
            >
              <MenuItem value="">{PORTABILITY_PAGE_STRINGS.exportScopeAllOption}</MenuItem>
              {collections.map((col) => (
                <MenuItem key={col.id} value={col.id}>
                  {col.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Checkbox
                checked={includeFiles}
                disabled={exporting}
                onChange={(e) => setIncludeFiles(e.target.checked)}
              />
            }
            label={PORTABILITY_PAGE_STRINGS.exportIncludeFilesLabel}
          />

          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={exporting} onClick={onClose}>
          {PORTABILITY_PAGE_STRINGS.exportCancelLabel}
        </Button>
        <Button
          variant="contained"
          startIcon={<DownloadOutlinedIcon fontSize="small" />}
          disabled={exporting}
          onClick={() => void handleSubmit()}
        >
          {exporting
            ? PORTABILITY_PAGE_STRINGS.exportSubmittingLabel
            : PORTABILITY_PAGE_STRINGS.exportSubmitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
