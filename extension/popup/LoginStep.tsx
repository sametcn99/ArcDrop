import { Alert, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { sendAuthMessage } from '../shared/messages';
import { errorString, strings } from '../shared/strings';

export interface LoginStepProps {
  baseUrl: string;
  onAuthenticated: (baseUrl: string, email: string) => void;
  onTotpRequired: (baseUrl: string, challenge: string, expiresAt: string) => void;
  onChangeServer: (baseUrl: string) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginStep({
  baseUrl,
  onAuthenticated,
  onTotpRequired,
  onChangeServer,
}: LoginStepProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validEmail = EMAIL_PATTERN.test(email.trim());
  const validPassword = password.length >= 8;

  const submit = (): void => {
    setError(null);
    if (!validEmail || !validPassword) {
      setError(errorString('VALIDATION'));
      return;
    }

    setBusy(true);
    void sendAuthMessage({ type: 'auth/login', email: email.trim(), password })
      .then((response) => {
        if (!response.ok) {
          setError(errorString(response.code));
          return;
        }
        if (response.kind === 'authenticated') {
          onAuthenticated(baseUrl, response.email);
        } else if (response.kind === 'totp-required') {
          onTotpRequired(baseUrl, response.challenge, response.expiresAt);
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
      <Typography variant="body2" color="text.secondary" noWrap>
        {strings.popup.stateLabel}: {baseUrl.replace(/^https?:\/\//, '')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {strings.popup.loginTitle} — {strings.popup.loginBody}
      </Typography>
      {error ? (
        <Alert severity="error">
          {error}
          {error === errorString('RATE_LIMITED') ? ' Please wait before retrying.' : null}
        </Alert>
      ) : null}
      <TextField
        label={strings.popup.emailFieldLabel}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        fullWidth
        size="small"
        type="email"
        autoComplete="off"
        autoFocus
        disabled={busy}
        error={email.length > 0 && !validEmail}
      />
      <TextField
        label={strings.popup.passwordFieldLabel}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        fullWidth
        size="small"
        type="password"
        disabled={busy}
        error={password.length > 0 && !validPassword}
      />
      <Button variant="contained" onClick={submit} disabled={busy || !validEmail || !validPassword}>
        {strings.popup.signInButton}
      </Button>
      <Link
        component="button"
        variant="caption"
        color="text.secondary"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => onChangeServer(baseUrl)}
        disabled={busy}
      >
        {strings.popup.changeServer}
      </Link>
    </Stack>
  );
}
