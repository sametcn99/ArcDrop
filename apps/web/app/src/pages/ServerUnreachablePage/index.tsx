import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { isWebApiOrigin } from '../../api/baseUrl';
import { apiClient } from '../../api/client';
import { readStoredBaseUrl } from '../../api/baseUrl';
import { useAuthStore } from '../../stores/authStore';
import { APP_STRINGS } from '../../app/strings';
import { AuthPageShell } from '../../shared/components/AuthPageShell';
import { SERVER_UNREACHABLE_PAGE_STRINGS as S } from './strings';

/** Effective base URL for display: stored address, else the page origin. */
function activeServerDisplay(): string {
  const stored = readStoredBaseUrl();
  if (stored) {
    return stored;
  }
  if (typeof window !== 'undefined' && isWebApiOrigin(window.location.origin)) {
    return window.location.origin;
  }
  return apiClient.getBaseUrl() || S.addressUnknownLabel;
}

/**
 * Boot-time offline screen (plan T5): shown when a persisted session exists
 * but the server itself cannot be reached — the refresh token is kept, so
 * "Retry" re-runs session restore and recovers without re-signing-in.
 */
export default function ServerUnreachablePage() {
  const navigate = useNavigate();
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = () => {
    setRetrying(true);
    void restoreSession().finally(() => setRetrying(false));
  };

  return (
    <AuthPageShell
      title={S.title}
      subtitle={S.subtitle}
      brandLabel={APP_STRINGS.brand}
      themeSwitcherLabel={APP_STRINGS.themeSwitcherLabel}
    >
      <Stack spacing={2.5} data-testid="server-unreachable-page">
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <CloudOffOutlinedIcon color="error" />
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {S.addressHeading}
          </Typography>
        </Stack>
        <Typography variant="body1" data-testid="server-unreachable-url">
          {activeServerDisplay()}
        </Typography>
        {retrying ? (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <CircularProgress size={18} aria-hidden />
            <Typography variant="body2" color="text.secondary">
              {S.retryingLabel}
            </Typography>
          </Stack>
        ) : null}
        <Button
          variant="contained"
          size="large"
          fullWidth
          disabled={retrying}
          onClick={handleRetry}
          data-testid="server-unreachable-retry"
        >
          {S.retryLabel}
        </Button>
        <Typography variant="body2" color="text.secondary">
          {S.changeServerPrompt}{' '}
          <Link
            component="button"
            type="button"
            underline="hover"
            onClick={() => navigate('/server')}
          >
            {S.changeServerLabel}
          </Link>
        </Typography>
      </Stack>
    </AuthPageShell>
  );
}
