import DoneAllOutlinedIcon from '@mui/icons-material/DoneAllOutlined';
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
import { useEffect } from 'react';
import {
  fetchNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '../../../shared/actions/notificationActions';
import { useNotificationsStore } from '../../../stores/notificationsStore';
import { SETTINGS_PAGE_STRINGS as S } from '../strings';

export function NotificationsSection() {
  const items = useNotificationsStore((s) => s.items);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const loading = useNotificationsStore((s) => s.loading);
  const needsRefresh = useNotificationsStore((s) => s.needsRefresh);

  useEffect(() => {
    if (needsRefresh || items.length === 0) {
      void fetchNotificationsAction().catch(() => undefined);
    }
  }, [needsRefresh, items.length]);

  return (
    <Card variant="outlined" data-testid="settings-notifications-section">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h6">{S.notifications.heading}</Typography>
          {unreadCount > 0 ? (
            <Chip size="small" color="primary" label={S.notifications.unreadCount(unreadCount)} />
          ) : null}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {S.notifications.description}
        </Typography>
        {loading && items.length === 0 ? (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <Skeleton variant="rounded" height={40} />
            <Skeleton variant="rounded" height={40} />
          </Stack>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {S.notifications.empty}
          </Typography>
        ) : (
          <List sx={{ mt: 1 }}>
            {items.map((item, index) => (
              <Stack key={item.id}>
                {index > 0 ? <Divider component="li" /> : null}
                <ListItem
                  secondaryAction={
                    item.readAt ? null : (
                      <Button
                        size="small"
                        onClick={() => void markNotificationReadAction(item.id)}
                        data-testid={`settings-notification-read-${item.id}`}
                      >
                        Mark read
                      </Button>
                    )
                  }
                >
                  <Stack spacing={0.25}>
                    <Typography variant="body1">{item.payload.title ?? 'Reminder'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(item.createdAt).toLocaleString()}
                    </Typography>
                  </Stack>
                </ListItem>
              </Stack>
            ))}
          </List>
        )}
        {unreadCount > 0 ? (
          <Button
            startIcon={<DoneAllOutlinedIcon />}
            size="small"
            sx={{ mt: 1 }}
            onClick={() => void markAllNotificationsReadAction()}
            data-testid="settings-notifications-mark-all"
          >
            {S.notifications.markAll}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
