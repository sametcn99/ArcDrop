import { apiClient, type ApiClient } from '../client';
import {
  tagSummarySchema,
  tagUsageListSchema,
  type TagSummary,
  type TagUsage,
} from '../schemas/bookmarks';

export function createTagsApi(client: ApiClient = apiClient) {
  return {
    async list(): Promise<TagUsage[]> {
      return client.get('/bookmarks/tags', {
        schema: tagUsageListSchema,
      });
    },

    async rename(currentName: string, nextName: string): Promise<TagSummary> {
      return client.put(
        `/tags/${encodeURIComponent(currentName)}`,
        { name: nextName },
        {
          schema: tagSummarySchema,
        },
      );
    },

    async remove(name: string): Promise<void> {
      await client.delete<void>(`/tags/${encodeURIComponent(name)}`);
    },
  };
}

export const tagsApi = createTagsApi();
