import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import {
  readStoredBaseUrl,
  validateArcDropServer,
  writeStoredBaseUrl,
  type ServerValidationFailureReason,
} from '../../api/baseUrl';
import { apiClient } from '../../api/client';
import { APP_STRINGS } from '../../app/strings';
import { AuthPageShell } from '../../shared/components/AuthPageShell';
import { SERVER_ADDRESS_PAGE_STRINGS as S } from './strings';

const FAILURE_TEXT: Record<ServerValidationFailureReason, string> = {
  'invalid-url': S.errorInvalidUrl,
  unreachable: S.errorUnreachable,
  'not-arcdrop': S.errorNotArcDrop,
};

/**
 * Server-address onboarding (plan T0): collects the ArcDrop server address at
 * runtime (Vaultwarden-style) so the same build works against any server.
 * Shown when no base URL can be resolved (stored address, env, same-origin) —
 * e.g. inside a fresh Tauri webview — or via Settings → "Change server".
 */
export default function ServerAddressPage() {
  const navigate = useNavigate();
  const [address, setAddress] = useState(() => readStoredBaseUrl() ?? '');
  const [validating, setValidating] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorText(null);
    setValidating(true);
    try {
      const result = await validateArcDropServer(address);
      if (!result.ok) {
        setErrorText(FAILURE_TEXT[result.reason]);
        return;
      }
      // Persist for the next boot and apply to the running client immediately.
      writeStoredBaseUrl(result.baseUrl);
      apiClient.setBaseUrl(result.baseUrl);
      navigate('/login', { replace: true });
    } finally {
      setValidating(false);
    }
  };

  return (
    <AuthPageShell
      title={S.title}
      subtitle={S.subtitle}
      brandLabel={APP_STRINGS.brand}
      themeSwitcherLabel={APP_STRINGS.themeSwitcherLabel}
    >
      <Box component="form" onSubmit={(event) => void handleConnect(event)} noValidate>
        <Stack spacing={2} data-testid="server-address-page">
          {errorText ? (
            <Alert severity="error" role="alert">
              {errorText}
            </Alert>
          ) : null}

          <TextField
            id="server-address"
            label={S.addressLabel}
            placeholder={S.addressPlaceholder}
            helperText={S.addressHelper}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            fullWidth
            required
            autoFocus
            disabled={validating}
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={validating || address.trim() === ''}
            startIcon={
              validating ? <CircularProgress size={18} color="inherit" aria-hidden /> : undefined
            }
            data-testid="server-connect"
          >
            {validating ? S.connectingLabel : S.connectLabel}
          </Button>
        </Stack>
      </Box>
    </AuthPageShell>
  );
}
