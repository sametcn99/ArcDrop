import { apiClient, type ApiClient } from '../client';
import {
  auditLogListSchema,
  createUserResponseSchema,
  resetPasswordResponseSchema,
  userListSchema,
  type AuditLogFilters,
  type AuditLogList,
  type CreateUserResponse,
  type ResetPasswordResponse,
  type User,
} from '../schemas/admin';
import type { operations } from '../types';

export function createAdminApi(client: ApiClient = apiClient) {
  return {
    async listUsers(): Promise<User[]> {
      const result = await client.get('/admin/users', {
        schema: userListSchema,
      });
      return result.items;
    },

    async createUser(input: { email: string; role: 'admin' | 'user' }): Promise<CreateUserResponse> {
      return client.post('/admin/users', input, {
        schema: createUserResponseSchema,
      });
    },

    async updateUser(
      userId: string,
      input: { role?: 'admin' | 'user'; status?: 'active' | 'disabled' },
    ): Promise<void> {
      await client.patch<void>(`/admin/users/${encodeURIComponent(userId)}`, input);
    },

    async resetUserPassword(userId: string): Promise<ResetPasswordResponse> {
      return client.post(
        `/admin/users/${encodeURIComponent(userId)}/reset-password`,
        undefined,
        {
          schema: resetPasswordResponseSchema,
        },
      );
    },

    async listAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogList> {
      const query: Record<string, string | number | undefined> = {};
      if (filters.action) query.action = filters.action;
      if (filters.actorType) query.actorType = filters.actorType;
      if (filters.actorUserId) query.actorUserId = filters.actorUserId;
      if (filters.outcome) query.outcome = filters.outcome;
      if (filters.subject) query.subject = filters.subject;
      if (filters.since) query.since = filters.since;
      if (filters.until) query.until = filters.until;
      if (filters.page !== undefined) query.page = filters.page;
      if (filters.pageSize !== undefined) query.pageSize = filters.pageSize;
      return client.get('/admin/audit', {
        schema: auditLogListSchema,
        query,
      });
    },
  };
}

export const adminApi = createAdminApi();

// Compile-time operation-name alignment against the generated OpenAPI paths.
type _AdminPathsCheck = [
  operations['listUsers'] extends never ? never : true,
  operations['createUser'] extends never ? never : true,
  operations['updateUser'] extends never ? never : true,
  operations['resetUserPassword'] extends never ? never : true,
  operations['listAuditLogs'] extends never ? never : true,
];
void (undefined as _AdminPathsCheck | undefined);
