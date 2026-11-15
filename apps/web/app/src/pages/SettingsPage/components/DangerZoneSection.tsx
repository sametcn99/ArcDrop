import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { syncEngine } from '../../../api/sync-engine';
import { useAuthStore } from '../../../stores/authStore';
import { useLibraryStore } from '../../../stores/libraryStore';
import { useNotificationsStore } from '../../../stores/notificationsStore';
import { useSyncStore } from '../../../stores/syncStore';
import { deleteAccountAction, resetLibraryAction } from '../actions/settingsActions';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

type DialogMode = 'reset' | 'delete' | null;

/**
 * Self-service account lifecycle (API M15): password-confirmed library reset
 * and account self-delete. Rendered at the bottom of the Settings page,
 * outside the tab content, so it stays reachable from every tab.
 */
export function DangerZoneSection() {
  const [mode, setMode] = useState<DialogMode>(null);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const closeDialog = () => {
    if (busy) return;
    setMode(null);
    setPassword('');
    setConfirmText('');
    setError(null);
  };

  const handleResetConfirm = async () => {
    if (busy || password === '') return;
    setBusy(true);
    setError(null);
    const errorDetail = await resetLibraryAction(password);
    setBusy(false);
    if (errorDetail !== null) {
      setError(errorDetail);
      return;
    }

    setMode(null);
    setPassword('');
    setConfirmText('');

    // Sessions survive a library reset, but the server wiped every bookmark,
    // collection, and change event and reset its sync sequence to 0. Local
    // caches and the change-log cursor must be rebuilt from that clean state,
    // or the sync engine would keep the stale library on screen (its pull
    // only triggers when the remote seq moves ABOVE the local cursor).
    syncEngine.stop();
    useSyncStore.getState().reset();
    useLibraryStore.getState().reset();
    useNotificationsStore.getState().reset();
    void syncEngine.start();
  };

  const handleDeleteConfirm = async () => {
    if (busy || password === '' || confirmText.trim().toUpperCase() !== 'DELETE') return;
    setBusy(true);
    setError(null);
    const errorDetail = await deleteAccountAction(password);
    setBusy(false);
    if (errorDetail !== null) {
      setError(errorDetail);
      return;
    }

    setMode(null);
    setPassword('');
    setConfirmText('');

    // The account (and with it every session) is gone server-side. Run the
    // standard client teardown; dropping the auth state routes the user back
    // to /login through the auth guard.
    await useAuthStore.getState().logout();
  };

  const isReset = mode === 'reset';
  const isDelete = mode === 'delete';
  const confirmDisabled =
    busy || password === '' || (isDelete && confirmText.trim().toUpperCase() !== 'DELETE');

  return (
    <Card variant="outlined" sx={{ borderColor: 'error.main' }} data-testid="settings-danger-zone">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <WarningAmberOutlinedIcon color="error" fontSize="small" />
          <Typography variant="h6">{S.dangerZone.heading}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {S.dangerZone.description}
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1">{S.dangerZone.resetTitle}</Typography>
            <Typography variant="body2" color="text.secondary">
              {S.dangerZone.resetDescription}
            </Typography>
          </Stack>
          <Button
            color="error"
            variant="outlined"
            size="small"
            onClick={() => {
              setMode('reset');
              setPassword('');
              setConfirmText('');
              setError(null);
            }}
            data-testid="settings-danger-reset-open"
          >
            {S.dangerZone.resetButton}
          </Button>
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Stack spacing={0.5} sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1">{S.dangerZone.deleteTitle}</Typography>
            <Typography variant="body2" color="text.secondary">
              {S.dangerZone.deleteDescription}
            </Typography>
          </Stack>
          <Button
            color="error"
            variant="contained"
            size="small"
            onClick={() => {
              setMode('delete');
              setPassword('');
              setConfirmText('');
              setError(null);
            }}
            data-testid="settings-danger-delete-open"
          >
            {S.dangerZone.deleteButton}
          </Button>
        </Stack>
      </CardContent>

      <Dialog open={mode !== null} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {isDelete ? S.dangerZone.deleteDialogTitle : S.dangerZone.resetDialogTitle}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Alert severity={isDelete ? 'error' : 'warning'}>
              {isDelete ? S.dangerZone.deleteDialogWarning : S.dangerZone.resetDialogWarning}
            </Alert>
            {isDelete ? (
              <TextField
                label={S.dangerZone.deleteConfirmTextLabel}
                placeholder={S.dangerZone.deleteConfirmTextHint}
                value={confirmText}
                disabled={busy}
                onChange={(e) => setConfirmText(e.target.value)}
                fullWidth
                data-testid="settings-danger-confirm-text"
              />
            ) : null}
            <TextField
              label={S.dangerZone.passwordLabel}
              type="password"
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              onSubmit={() => void (isReset ? handleResetConfirm() : handleDeleteConfirm())}
              fullWidth
              autoFocus={!isDelete}
              data-testid="settings-danger-password"
            />
            {error ? (
              <Alert severity="error" data-testid="settings-danger-error">
                {error}
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={closeDialog}>
            {S.dangerZone.cancelLabel}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={confirmDisabled}
            onClick={() => void (isReset ? handleResetConfirm() : handleDeleteConfirm())}
            data-testid={
              isReset ? 'settings-danger-reset-confirm' : 'settings-danger-delete-confirm'
            }
          >
            {isReset ? S.dangerZone.resetConfirmLabel : S.dangerZone.deleteConfirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
