import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { sendAuthMessage } from '../shared/messages';
import { errorString, strings } from '../shared/strings';

export interface TotpStepProps {
  baseUrl: string;
  challenge: string;
  onAuthenticated: (baseUrl: string, email: string) => void;
  onBack: (baseUrl: string) => void;
}

/**
 * Second sign-in step after a 401 TOTP_REQUIRED: accepts either a TOTP code
 * or (toggle) a single-use recovery code, both validated by the server
 * against the short-lived challenge token.
 */
export function TotpStep({ baseUrl, challenge, onAuthenticated, onBack }: TotpStepProps) {
  const [value, setValue] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setError(errorString('VALIDATION'));
      return;
    }

    setBusy(true);
    setError(null);
    const message = recoveryMode
      ? { type: 'auth/login-tfa' as const, challenge, recoveryCode: trimmed }
      : { type: 'auth/login-tfa' as const, challenge, code: trimmed };
    void sendAuthMessage(message)
      .then((response) => {
        if (!response.ok) {
          setError(errorString(response.code));
          return;
        }
        if (response.kind === 'authenticated') {
          onAuthenticated(baseUrl, response.email);
        }
      })
      .catch(() => {
        setError(errorString('NETWORK_ERROR'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <Stack spacing={1.5}>
      <Typography variant="h6" component="h1">
        {strings.appName}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {strings.popup.totpTitle}. {strings.popup.totpBody}
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        label={recoveryMode ? strings.popup.recoverCodeFieldLabel : strings.popup.totpFieldLabel}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        fullWidth
        size="small"
        autoFocus
        disabled={busy}
      />
      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={submit} disabled={busy || value.trim().length === 0}>
          {strings.popup.verifyButton}
        </Button>
        <Button variant="text" onClick={() => onBack(baseUrl)} disabled={busy}>
          {strings.popup.backButton}
        </Button>
      </Stack>
      <Link
        component="button"
        variant="caption"
        color="text.secondary"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => setRecoveryMode((current) => !current)}
        disabled={busy}
      >
        {recoveryMode ? strings.popup.useTotpCode : strings.popup.useRecoveryCode}
      </Link>
    </Stack>
  );
}
