import { apiClient, type ApiClient } from '../client';
import { settingsSchema, type Settings } from '../schemas/settings';

export function createSettingsApi(client: ApiClient = apiClient) {
  return {
    async get(): Promise<Settings> {
      return client.get('/admin/settings', {
        schema: settingsSchema,
      });
    },

    async update(input: Settings): Promise<Settings> {
      return client.put('/admin/settings', input, {
        schema: settingsSchema,
      });
    },
  };
}

export const settingsApi = createSettingsApi();
