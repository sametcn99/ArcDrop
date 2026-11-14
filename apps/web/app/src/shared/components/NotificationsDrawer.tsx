import CloseIcon from '@mui/icons-material/Close';
import DoneAllOutlinedIcon from '@mui/icons-material/DoneAllOutlined';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useBookmarkDetailNavigationState } from '../hooks/useBookmarkDetailNavigationState';
import { useNotificationsStore } from '../../stores/notificationsStore';
import {
  fetchNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '../actions/notificationActions';
import { SHARED_NOTIFICATION_STRINGS } from '../strings';

export function NotificationsDrawer() {
  const open = useNotificationsStore((s) => s.drawerOpen);
  const items = useNotificationsStore((s) => s.items);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const loading = useNotificationsStore((s) => s.loading);
  const error = useNotificationsStore((s) => s.error);
  const needsRefresh = useNotificationsStore((s) => s.needsRefresh);
  const setDrawerOpen = useNotificationsStore((s) => s.setDrawerOpen);

  const navigate = useNavigate();
  const detailLinkState = useBookmarkDetailNavigationState();

  useEffect(() => {
    if (!open) return;
    if (needsRefresh || items.length === 0) {
      void fetchNotificationsAction().catch(() => undefined);
    }
  }, [open, needsRefresh, items.length]);

  const handleClose = () => {
    setDrawerOpen(false);
  };

  const handleOpenBookmark = (
    notificationId: string,
    bookmarkId: string | null,
    isUnread: boolean,
  ) => {
    if (isUnread) {
      void markNotificationReadAction(notificationId).catch(() => undefined);
    }
    if (bookmarkId) {
      setDrawerOpen(false);
      navigate(`/bookmarks/${bookmarkId}`, { state: detailLinkState });
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={handleClose}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', sm: 400 },
            maxWidth: '100%',
          },
        },
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2.5,
            py: 2,
          }}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" component="h2">
              {SHARED_NOTIFICATION_STRINGS.drawerTitle}
            </Typography>
            {unreadCount > 0 ? <Chip size="small" color="primary" label={unreadCount} /> : null}
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Button
              size="small"
              startIcon={<DoneAllOutlinedIcon fontSize="small" />}
              disabled={unreadCount === 0 || loading}
              onClick={() => void markAllNotificationsReadAction().catch(() => undefined)}
            >
              {SHARED_NOTIFICATION_STRINGS.markAllReadLabel}
            </Button>
            <IconButton aria-label={SHARED_NOTIFICATION_STRINGS.closeLabel} onClick={handleClose}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </Stack>

        <Divider />

        <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}

          {loading && items.length === 0 ? (
            <Stack spacing={1.5}>
              <Skeleton variant="rounded" height={72} />
              <Skeleton variant="rounded" height={72} />
            </Stack>
          ) : items.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <NotificationsNoneOutlinedIcon color="disabled" sx={{ fontSize: 40, mb: 1 }} />
              <Typography variant="subtitle2">{SHARED_NOTIFICATION_STRINGS.emptyTitle}</Typography>
              <Typography variant="body2" color="text.secondary">
                {SHARED_NOTIFICATION_STRINGS.emptyHint}
              </Typography>
            </Box>
          ) : (
            <List disablePadding>
              {items.map((item, index) => {
                const isUnread = item.readAt === null;
                const title = item.payload.title ?? SHARED_NOTIFICATION_STRINGS.untitledBookmark;
                const targetBookmarkId = item.bookmarkId ?? item.payload.bookmarkId;

                return (
                  <Box key={item.id}>
                    {index > 0 ? <Divider sx={{ my: 1 }} /> : null}
                    <ListItem
                      data-testid={`notification-item-${item.id}`}
                      sx={{
                        px: 1.5,
                        py: 1.25,
                        borderRadius: 1,
                        bgcolor: isUnread ? 'action.selected' : 'transparent',
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: 1,
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle2" noWrap>
                            {title}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: 'block' }}
                          >
                            {`${SHARED_NOTIFICATION_STRINGS.reminderLabelPrefix}: ${new Date(
                              item.payload.reminderAt,
                            ).toLocaleString()}`}
                          </Typography>
                        </Box>
                        {isUnread ? (
                          <Chip
                            size="small"
                            color="primary"
                            label={SHARED_NOTIFICATION_STRINGS.unreadBadgeLabel}
                          />
                        ) : null}
                      </Stack>

                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        {targetBookmarkId ? (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleOpenBookmark(item.id, targetBookmarkId, isUnread)}
                          >
                            {SHARED_NOTIFICATION_STRINGS.openBookmarkLabel}
                          </Button>
                        ) : null}
                        {isUnread ? (
                          <Button
                            size="small"
                            onClick={() =>
                              void markNotificationReadAction(item.id).catch(() => undefined)
                            }
                          >
                            {SHARED_NOTIFICATION_STRINGS.markReadLabel}
                          </Button>
                        ) : null}
                      </Stack>
                    </ListItem>
                  </Box>
                );
              })}
            </List>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
