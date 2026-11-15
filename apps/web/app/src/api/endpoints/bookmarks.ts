import { apiClient, type ApiClient, type BlobResponse } from '../client';
import {
  bookmarkArchiveSchema,
  bookmarkCollectionsResponseSchema,
  bookmarkListResponseSchema,
  bookmarkSchema,
  bookmarkStatsSchema,
  bulkBookmarksResponseSchema,
  reindexBookmarkResponseSchema,
  tagUsageListSchema,
  type Bookmark,
  type BookmarkArchive,
  type BookmarkCollectionsResponse,
  type BookmarkListQuery,
  type BookmarkListResponse,
  type BookmarkStats,
  type BulkBookmarksRequest,
  type BulkBookmarksResponse,
  type CreateBookmarkQuery,
  type CreateBookmarkRequest,
  type ReindexBookmarkResponse,
  type TagUsage,
  type UpdateBookmarkRequest,
  type UploadBookmarkFileInput,
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

    async create(input: CreateBookmarkRequest, query?: CreateBookmarkQuery): Promise<Bookmark> {
      return client.post('/bookmarks', input, {
        query: query
          ? {
              collection: query.collection,
              url: query.url,
              title: query.title,
              excerpt: query.excerpt,
              note: query.note,
              favorite: query.favorite,
            }
          : undefined,
        schema: bookmarkSchema,
      });
    },

    async uploadFile(
      input: UploadBookmarkFileInput,
      options?: { signal?: AbortSignal },
    ): Promise<Bookmark> {
      const formData = new FormData();
      formData.append('file', input.file, input.file.name);

      if (input.title !== undefined && input.title.trim() !== '') {
        formData.append('title', input.title.trim());
      }
      if (input.excerpt !== undefined && input.excerpt.trim() !== '') {
        formData.append('excerpt', input.excerpt.trim());
      }
      if (input.note !== undefined && input.note.trim() !== '') {
        formData.append('note', input.note.trim());
      }
      if (input.favorite !== undefined) {
        formData.append('favorite', String(input.favorite));
      }
      if (input.tags && input.tags.length > 0) {
        formData.append('tags', JSON.stringify(input.tags));
      }
      if (input.collectionIds && input.collectionIds.length > 0) {
        formData.append('collectionIds', JSON.stringify(input.collectionIds));
      }
      if (input.reminderAt) {
        formData.append('reminderAt', input.reminderAt);
      }

      return client.post('/bookmarks/file', formData, {
        schema: bookmarkSchema,
        signal: options?.signal,
      });
    },

    async getFileBlob(
      idOrRef: string,
      options?: { download?: boolean; signal?: AbortSignal },
    ): Promise<BlobResponse> {
      return client.getBlob(`/files/${encodeURIComponent(idOrRef)}`, {
        query: options?.download ? { download: 1 } : undefined,
        signal: options?.signal,
      });
    },

    async getArchive(id: string, options?: { signal?: AbortSignal }): Promise<BookmarkArchive> {
      return client.get(`/bookmarks/${encodeURIComponent(id)}/archive`, {
        schema: bookmarkArchiveSchema,
        signal: options?.signal,
      });
    },

    async reindex(id: string): Promise<ReindexBookmarkResponse> {
      return client.post(`/bookmarks/${encodeURIComponent(id)}/reindex`, undefined, {
        schema: reindexBookmarkResponseSchema,
      });
    },

    async update(id: string, input: UpdateBookmarkRequest): Promise<Bookmark> {
      return client.put(`/bookmarks/${encodeURIComponent(id)}`, input, {
        schema: bookmarkSchema,
      });
    },

    async replaceTags(id: string, tags: string[]): Promise<Bookmark> {
      return client.put(
        `/bookmarks/${encodeURIComponent(id)}/tags`,
        { tags },
        {
          schema: bookmarkSchema,
        },
      );
    },

    async replaceCollections(
      id: string,
      collectionIds: string[],
    ): Promise<BookmarkCollectionsResponse> {
      return client.put(
        `/bookmarks/${encodeURIComponent(id)}/collections`,
        { collectionIds },
        {
          schema: bookmarkCollectionsResponseSchema,
        },
      );
    },

    async bulk(input: BulkBookmarksRequest): Promise<BulkBookmarksResponse> {
      return client.post('/bookmarks/bulk', input, {
        schema: bulkBookmarksResponseSchema,
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

    /** Cover images are served by the same public `/icons/{id}` surface. */
    coverUrl(coverRef: string): string {
      return client.resolveUrl(`/icons/${encodeURIComponent(coverRef)}`);
    },
  };
}

export const bookmarksApi = createBookmarksApi();
