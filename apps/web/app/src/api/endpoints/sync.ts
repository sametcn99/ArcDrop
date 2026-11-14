import { apiClient, type ApiClient } from '../client';
import {
  syncChangesResponseSchema,
  syncStateSchema,
  syncTicketSchema,
  type SyncChangesResponse,
  type SyncState,
  type SyncTicket,
} from '../schemas/sync';

export function createSyncApi(client: ApiClient = apiClient) {
  return {
    async getState(): Promise<SyncState> {
      return client.get('/sync/state', {
        schema: syncStateSchema,
      });
    },

    async getChanges(since: string, limit?: number): Promise<SyncChangesResponse> {
      return client.get('/sync/changes', {
        query: {
          since,
          limit,
        },
        schema: syncChangesResponseSchema,
      });
    },

    async createTicket(): Promise<SyncTicket> {
      return client.post('/sync/ticket', undefined, {
        schema: syncTicketSchema,
      });
    },
  };
}

export const syncApi = createSyncApi();
