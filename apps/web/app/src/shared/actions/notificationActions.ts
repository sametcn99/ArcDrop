import { notificationsApi } from '../../api/endpoints/notifications';
import type { NotificationListResponse } from '../../api/schemas/notifications';
import { toApiError } from '../../api/schemas/problem';
import { useNotificationsStore } from '../../stores/notificationsStore';
import { useUiStore } from '../../stores/uiStore';
import { SHARED_NOTIFICATION_STRINGS } from '../strings';

export async function fetchNotificationsAction(): Promise<NotificationListResponse> {
  const store = useNotificationsStore.getState();
  store.setLoading(true);
  try {
    const res = await notificationsApi.list({ page: 1, pageSize: 50 });
    useNotificationsStore.getState().hydrateNotifications(res);
    return res;
  } catch (err) {
    const apiErr = toApiError(err);
    useNotificationsStore.getState().setError(apiErr.detail);
    throw apiErr;
  }
}

export async function markNotificationReadAction(id: string): Promise<void> {
  try {
    await notificationsApi.markRead({ ids: [id] });
    useNotificationsStore.getState().markOneReadLocally(id, new Date().toISOString());
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not mark notification as read.',
      severity: 'error',
    });
    throw apiErr;
  }
}

export async function markAllNotificationsReadAction(): Promise<void> {
  try {
    await notificationsApi.markRead({ all: true });
    useNotificationsStore.getState().markAllReadLocally(new Date().toISOString());
    useUiStore.getState().enqueueSnackbar({
      message: SHARED_NOTIFICATION_STRINGS.toastAllRead,
      severity: 'success',
    });
  } catch (err) {
    const apiErr = toApiError(err);
    useUiStore.getState().enqueueSnackbar({
      message: apiErr.detail || 'Could not mark notifications as read.',
      severity: 'error',
    });
    throw apiErr;
  }
}
