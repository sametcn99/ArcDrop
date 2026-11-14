import { apiClient, type ApiClient } from '../client';
import {
  bookmarkListResponseSchema,
  bookmarkSchema,
  bookmarkStatsSchema,
  tagUsageListSchema,
  type Bookmark,
  type BookmarkListQuery,
  type BookmarkListResponse,
  type BookmarkStats,
  type TagUsage,
  type UpdateBookmarkRequest,
} from '../schemas/bookmarks';

export function createBookmarksApi(client: ApiClient = apiClient) {
  return {
    async list(query: BookmarkListQuery = {}): Promise<BookmarkListResponse> {
      return client.get('/bookmarks', {
        query: {
          page: query.page,
          pageSize: query.pageSize,
          sort: query.sort,
          collectionId: query.collectionId,
          tag: query.tag,
          domain: query.domain,
          favorite: query.favorite,
          broken: query.broken,
          reminder: query.reminder,
          file: query.file,
          type: query.type,
          cacheStatus: query.cacheStatus,
          unassignedOnly: query.unassignedOnly,
          trashed: query.trashed,
          updatedSince: query.updatedSince,
          search: query.search,
          q: query.q,
        },
        schema: bookmarkListResponseSchema,
      });
    },

    async get(id: string): Promise<Bookmark> {
      return client.get(`/bookmarks/${encodeURIComponent(id)}`, {
        schema: bookmarkSchema,
      });
    },

    async update(id: string, input: UpdateBookmarkRequest): Promise<Bookmark> {
      return client.put(`/bookmarks/${encodeURIComponent(id)}`, input, {
        schema: bookmarkSchema,
      });
    },

    async trash(id: string): Promise<void> {
      await client.delete<void>(`/bookmarks/${encodeURIComponent(id)}`);
    },

    async restore(id: string): Promise<Bookmark> {
      return client.post(`/bookmarks/${encodeURIComponent(id)}/restore`, undefined, {
        schema: bookmarkSchema,
      });
    },

    async stats(): Promise<BookmarkStats> {
      return client.get('/bookmarks/stats', {
        schema: bookmarkStatsSchema,
      });
    },

    async tags(): Promise<TagUsage[]> {
      return client.get('/bookmarks/tags', {
        schema: tagUsageListSchema,
      });
    },

    iconUrl(iconRef: string): string {
      return client.resolveUrl(`/icons/${encodeURIComponent(iconRef)}`);
    },
  };
}

export const bookmarksApi = createBookmarksApi();
