import Alert from '@mui/material/Alert';
import Snackbar, { type SnackbarCloseReason } from '@mui/material/Snackbar';
import type { SyntheticEvent } from 'react';
import { useUiStore } from '../../stores/uiStore';

const DEFAULT_AUTO_HIDE_MS = 5000;

export function SnackbarHost() {
  const snackbars = useUiStore((s) => s.snackbars);
  const dismissSnackbar = useUiStore((s) => s.dismissSnackbar);

  const current = snackbars[0];
  if (!current) {
    return null;
  }

  const handleClose = (_event?: SyntheticEvent | Event | null, reason?: SnackbarCloseReason) => {
    if (reason === 'clickaway') {
      return;
    }
    dismissSnackbar(current.id);
  };

  return (
    <Snackbar
      key={current.id}
      open
      autoHideDuration={current.autoHideDuration ?? DEFAULT_AUTO_HIDE_MS}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        onClose={(event) => handleClose(event)}
        severity={current.severity}
        variant="filled"
        sx={{ width: '100%' }}
      >
        {current.message}
      </Alert>
    </Snackbar>
  );
}
