import { Alert, Button, Divider, Stack, Typography } from '@mui/material';
import { useState } from 'react';
import { sendAuthMessage } from '../shared/messages';
import { errorString, strings } from '../shared/strings';

export interface ConnectedStepProps {
  baseUrl: string;
  email: string;
  onDisconnected: () => void;
}

/** Signed-in view: server + account summary, open-app placeholder, logout. */
export function ConnectedStep({ baseUrl, email, onDisconnected }: ConnectedStepProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = (): void => {
    setBusy(true);
    setError(null);
    void sendAuthMessage({ type: 'auth/disconnect' })
      .then((response) => {
        if (response.ok) {
          onDisconnected();
        } else {
          setError(errorString(response.code));
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
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack spacing={0.5}>
        <Typography variant="caption" color="text.secondary">
          {strings.popup.stateLabel}
        </Typography>
        <Typography variant="body2" noWrap>
          {baseUrl.replace(/^https?:\/\//, '')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {strings.popup.accountLabel}
        </Typography>
        <Typography variant="body2" noWrap>
          {email}
        </Typography>
      </Stack>
      <Divider />
      <Button variant="contained" disabled>
        {strings.popup.openApp}
      </Button>
      <Typography variant="caption" color="text.secondary">
        {strings.popup.openAppCaption}
      </Typography>
      <Button variant="outlined" color="error" onClick={disconnect} disabled={busy}>
        {strings.popup.disconnect}
      </Button>
    </Stack>
  );
}
