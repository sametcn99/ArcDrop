import { apiClient, type ApiClient } from '../client';
import {
  collectionListResponseSchema,
  type CollectionListQuery,
  type CollectionListResponse,
} from '../schemas/collections';

export function createCollectionsApi(client: ApiClient = apiClient) {
  return {
    async list(query: CollectionListQuery = {}): Promise<CollectionListResponse> {
      return client.get('/collections', {
        query: {
          shared: query.shared,
        },
        schema: collectionListResponseSchema,
      });
    },
  };
}

export const collectionsApi = createCollectionsApi();
