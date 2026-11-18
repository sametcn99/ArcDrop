import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router';
import { isWebApiOrigin } from '../../../api/baseUrl';
import { apiClient } from '../../../api/client';
import { APP_STRINGS } from '../../../app/strings';
import { useAuthStore } from '../../../stores/authStore';
import { useUiStore } from '../../../stores/uiStore';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

/**
 * Settings → Server (plan T0): shows the active API base URL and lets the
 * user switch servers. Changing the server signs the user out — the session's
 * refresh token belongs to the previous server — and returns to onboarding.
 */
export function ServerSection() {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const enqueueSnackbar = useUiStore((s) => s.enqueueSnackbar);

  const activeBaseUrl = apiClient.getBaseUrl();
  const displayUrl =
    activeBaseUrl !== ''
      ? activeBaseUrl
      : typeof window !== 'undefined' && isWebApiOrigin(window.location.origin)
        ? window.location.origin
        : S.server.noneLabel;

  const handleChangeServer = async () => {
    await logout();
    enqueueSnackbar({ message: APP_STRINGS.signedOutMessage, severity: 'info' });
    navigate('/server');
  };

  return (
    <Card variant="outlined" data-testid="settings-server-section">
      <CardContent>
        <Typography variant="h6">{S.server.heading}</Typography>
        <Typography variant="body2" color="text.secondary">
          {S.server.description}
        </Typography>
        <Stack spacing={0.5} sx={{ mt: 2 }}>
          <Typography variant="subtitle2" color="text.secondary">
            {S.server.currentLabel}
          </Typography>
          <Typography variant="body1" data-testid="settings-server-url">
            {displayUrl}
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {S.server.changeWarning}
        </Typography>
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            onClick={() => void handleChangeServer()}
            data-testid="settings-server-change"
          >
            {S.server.changeButton}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
