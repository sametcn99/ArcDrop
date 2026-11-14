import { apiClient, type ApiClient } from '../client';
import {
  markNotificationsReadResponseSchema,
  notificationListResponseSchema,
  type MarkNotificationsReadRequest,
  type MarkNotificationsReadResponse,
  type NotificationListQuery,
  type NotificationListResponse,
} from '../schemas/notifications';

export function createNotificationsApi(client: ApiClient = apiClient) {
  return {
    async list(query: NotificationListQuery = {}): Promise<NotificationListResponse> {
      return client.get('/notifications', {
        query: {
          unread: query.unread,
          page: query.page,
          pageSize: query.pageSize,
        },
        schema: notificationListResponseSchema,
      });
    },

    async markRead(input: MarkNotificationsReadRequest): Promise<MarkNotificationsReadResponse> {
      return client.post('/notifications/read', input, {
        schema: markNotificationsReadResponseSchema,
      });
    },
  };
}

export const notificationsApi = createNotificationsApi();
