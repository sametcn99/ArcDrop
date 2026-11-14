import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { authApi } from '../../../api/endpoints/auth';
import type { TfaEnableResponse, TfaSetupResponse } from '../../../api/schemas/auth';
import { toApiError } from '../../../api/schemas/problem';
import { useAuthStore } from '../../../stores/authStore';
import { useUiStore } from '../../../stores/uiStore';
import { OnceTokenDialog } from '../../../shared/components/OnceTokenDialog';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

export function TwoFactorSection() {
  const user = useAuthStore((s) => s.user);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const enabled = user?.totpEnabled ?? false;

  const [setup, setSetup] = useState<TfaSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<TfaEnableResponse | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  const handleSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      setSetup(await authApi.setupTfa());
    } catch (err) {
      setError(toApiError(err).detail);
    } finally {
      setBusy(false);
    }
  };

  const handleEnable = async () => {
    if (!setup) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authApi.enableTfa(code);
      setRecovery(response);
      setSetup(null);
      setCode('');
      await refreshProfile();
    } catch (err) {
      setError(toApiError(err).detail);
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    setError(null);
    try {
      await authApi.disableTfa({ code: disableCode.trim() });
      setDisableOpen(false);
      setDisableCode('');
      await refreshProfile();
      useUiStore.getState().enqueueSnackbar({
        message: 'Two-factor authentication disabled.',
        severity: 'success',
      });
    } catch (err) {
      setError(toApiError(err).detail);
      setBusy(false);
    }
  };

  return (
    <Card variant="outlined" data-testid="settings-tfa-section">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <KeyOutlinedIcon />
          <Typography variant="h6">{S.security.tfaHeading}</Typography>
          <Chip
            size="small"
            color={enabled ? 'success' : 'default'}
            label={enabled ? S.security.tfaEnabled : S.security.tfaDisabled}
            data-testid="settings-tfa-status"
          />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {enabled ? S.security.tfaOnDescription : S.security.tfaOffDescription}
        </Typography>
        {error ? (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          {enabled ? (
            <Button
              color="error"
              variant="outlined"
              onClick={() => setDisableOpen(true)}
              data-testid="settings-tfa-disable"
            >
              {S.security.tfaDisableButton}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={handleSetup}
              disabled={busy}
              data-testid="settings-tfa-setup"
            >
              {S.security.tfaSetupButton}
            </Button>
          )}
        </Stack>
      </CardContent>

      <Dialog
        open={setup !== null}
        onClose={() => setSetup(null)}
        maxWidth="xs"
        fullWidth
        data-testid="settings-tfa-setup-dialog"
      >
        <DialogTitle>{S.security.tfaSetupButton}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1, alignItems: 'center' }}>
            {setup ? (
              <Box
                sx={{ p: 1.5, bgcolor: 'background.paper', borderRadius: 1 }}
                data-testid="settings-tfa-qr"
              >
                <QRCodeSVG value={setup.otpauthUri} size={192} />
              </Box>
            ) : null}
            <Typography variant="body2" color="text.secondary">
              Scan with your authenticator app, or enter the secret manually:
            </Typography>
            {setup ? (
              <Typography
                variant="body2"
                sx={{ fontFamily: 'mono.fontFamily', wordBreak: 'break-all' }}
                data-testid="settings-tfa-secret"
              >
                {setup.secret}
              </Typography>
            ) : null}
            <TextField
              label="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              fullWidth
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSetup(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleEnable}
            disabled={busy || code.trim().length < 6}
            data-testid="settings-tfa-enable"
          >
            Enable
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={disableOpen} onClose={() => setDisableOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{S.security.tfaDisableButton}</DialogTitle>
        <DialogContent>
          <TextField
            label="TOTP code or recovery code"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisableOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDisable}
            disabled={busy || disableCode.trim() === ''}
            data-testid="settings-tfa-disable-confirm"
          >
            Disable
          </Button>
        </DialogActions>
      </Dialog>

      <OnceTokenDialog
        open={recovery !== null}
        title="Recovery codes"
        description="Each recovery code works exactly once. Store them somewhere safe — with the app and the codes gone, the account cannot be recovered."
        secrets={recovery?.recoveryCodes ?? []}
        onConfirm={() => setRecovery(null)}
      />
    </Card>
  );
}
