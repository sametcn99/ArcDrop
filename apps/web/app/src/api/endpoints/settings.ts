import { apiClient, type ApiClient } from '../client';
import { settingsSchema, type Settings } from '../schemas/settings';

export function createSettingsApi(client: ApiClient = apiClient) {
  return {
    async get(): Promise<Settings> {
      return client.get('/admin/settings', {
        schema: settingsSchema,
      });
    },
  };
}

export const settingsApi = createSettingsApi();
