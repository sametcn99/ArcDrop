import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { requestOriginPermission, chromePermissions } from '../shared/hostPermissions';
import { sendAuthMessage } from '../shared/messages';
import { errorString, strings } from '../shared/strings';
import { normalizeServerUrl } from '../shared/serverUrl';

export interface SetupStepProps {
  initialUrl: string;
  onValidated: (baseUrl: string) => void;
}

/**
 * First-run step: server address → runtime host permission for that origin
 * only → server identity check. The permission request must happen directly
 * in this click handler (user gesture); the broker refuses to proceed
 * without it.
 */
export function SetupStep({ initialUrl, onValidated }: SetupStepProps) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    setError(null);

    const normalized = normalizeServerUrl(url);
    if (!normalized.ok) {
      setError(errorString('VALIDATION'));
      return;
    }

    setBusy(true);
    void requestOriginPermission(chromePermissions(), normalized.origin)
      .then((granted) => {
        if (!granted) {
          setError(
            `${strings.popup.permissionDeniedTitle} — ${strings.popup.permissionDeniedBody}`,
          );
          return;
        }
        return sendAuthMessage({ type: 'auth/validate-server', serverUrl: normalized.url }).then(
          (response) => {
            if (response.ok) {
              onValidated(normalized.url);
            } else {
              setError(errorString(response.code));
            }
          },
        );
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
        {strings.popup.setupTitle} — {strings.popup.setupBody}
      </Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField
        label={strings.popup.serverFieldLabel}
        placeholder={strings.popup.serverFieldPlaceholder}
        helperText={strings.popup.serverFieldHelp}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        fullWidth
        size="small"
        autoFocus
        disabled={busy}
      />
      <Button variant="contained" onClick={submit} disabled={busy || url.trim().length === 0}>
        {strings.popup.continueButton}
      </Button>
    </Stack>
  );
}
