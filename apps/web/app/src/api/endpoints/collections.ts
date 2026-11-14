import { apiClient, type ApiClient } from '../client';
import {
  collectionListResponseSchema,
  collectionSchema,
  collectionShareResponseSchema,
  collectionTreeResponseSchema,
  deleteEmptyCollectionsResponseSchema,
  mergeCollectionsResponseSchema,
  sortCollectionsResponseSchema,
  type BookmarkOrderItem,
  type Collection,
  type CollectionListQuery,
  type CollectionListResponse,
  type CollectionNode,
  type CollectionOrderItem,
  type CollectionShareResponse,
  type CreateCollectionRequest,
  type DeleteEmptyCollectionsResponse,
  type MergeCollectionsRequest,
  type MergeCollectionsResponse,
  type SortCollectionsResponse,
  type UpdateCollectionRequest,
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

    async tree(): Promise<CollectionNode[]> {
      return client.get('/collections/tree', {
        schema: collectionTreeResponseSchema,
      });
    },

    async get(id: string): Promise<Collection> {
      return client.get(`/collections/${encodeURIComponent(id)}`, {
        schema: collectionSchema,
      });
    },

    async create(input: CreateCollectionRequest): Promise<Collection> {
      return client.post('/collections', input, {
        schema: collectionSchema,
      });
    },

    async update(id: string, input: UpdateCollectionRequest): Promise<Collection> {
      return client.put(`/collections/${encodeURIComponent(id)}`, input, {
        schema: collectionSchema,
      });
    },

    async delete(id: string, options: { cascade?: 'trash' } = {}): Promise<void> {
      await client.delete<void>(`/collections/${encodeURIComponent(id)}`, {
        query: options.cascade ? { cascade: options.cascade } : undefined,
      });
    },

    async restore(id: string): Promise<Collection> {
      return client.post(`/collections/${encodeURIComponent(id)}/restore`, undefined, {
        schema: collectionSchema,
      });
    },

    async reorder(items: CollectionOrderItem[]): Promise<void> {
      await client.patch<void>('/collections/order', { items });
    },

    async reorderBookmarks(id: string, items: BookmarkOrderItem[]): Promise<void> {
      await client.patch<void>(`/collections/${encodeURIComponent(id)}/bookmarks/order`, {
        items,
      });
    },

    async setShare(id: string, enabled: boolean): Promise<CollectionShareResponse> {
      return client.put(
        `/collections/${encodeURIComponent(id)}/share`,
        { enabled },
        {
          schema: collectionShareResponseSchema,
        },
      );
    },

    async merge(input: MergeCollectionsRequest): Promise<MergeCollectionsResponse> {
      return client.post('/collections/merge', input, {
        schema: mergeCollectionsResponseSchema,
      });
    },

    async sortAlphabetical(): Promise<SortCollectionsResponse> {
      return client.post('/collections/sort-alphabetical', undefined, {
        schema: sortCollectionsResponseSchema,
      });
    },

    async deleteEmpty(): Promise<DeleteEmptyCollectionsResponse> {
      return client.post('/collections/delete-empty', undefined, {
        schema: deleteEmptyCollectionsResponseSchema,
      });
    },

    resolveShareUrl(path: string): string {
      return client.resolveUrl(path);
    },
  };
}

export const collectionsApi = createCollectionsApi();
