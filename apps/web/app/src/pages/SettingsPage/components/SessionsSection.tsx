import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { revokeSessionAction } from '../hooks/useSettingsData';
import { useSessions } from '../hooks/useSettingsData';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

export function SessionsSection() {
  const { sessions, loading, error, refresh } = useSessions();

  const handleRevoke = async (sessionId: string) => {
    const result = await revokeSessionAction(sessionId);
    if (result.ok) {
      await refresh();
    }
  };

  return (
    <Card variant="outlined" data-testid="settings-sessions-section">
      <CardContent>
        <Typography variant="h6">{S.security.sessionsHeading}</Typography>
        {error ? (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {error}
          </Typography>
        ) : null}
        {loading ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <Skeleton variant="rounded" height={44} />
            <Skeleton variant="rounded" height={44} />
          </Stack>
        ) : sessions.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {S.security.sessionsEmpty}
          </Typography>
        ) : (
          <List sx={{ mt: 1 }}>
            {sessions.map((session, index) => (
              <Stack key={session.id}>
                {index > 0 ? <Divider component="li" /> : null}
                <ListItem
                  secondaryAction={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      {session.current ? (
                        <Chip size="small" label={S.security.currentSession} />
                      ) : (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => void handleRevoke(session.id)}
                          data-testid={`settings-revoke-session-${session.id}`}
                        >
                          {S.security.revoke}
                        </Button>
                      )}
                    </Stack>
                  }
                >
                  <Stack spacing={0.5}>
                    <Typography variant="body1">{session.deviceLabel}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {session.lastUsedAt
                        ? `Last used ${new Date(session.lastUsedAt).toLocaleString()}`
                        : 'Never used'}
                    </Typography>
                  </Stack>
                </ListItem>
              </Stack>
            ))}
          </List>
        )}
      </CardContent>
    </Card>
  );
}
