import { apiClient, type ApiClient } from '../client';
import {
  highlightListResponseSchema,
  highlightSchema,
  type CreateHighlightRequest,
  type Highlight,
  type HighlightListResponse,
  type UpdateHighlightRequest,
} from '../schemas/bookmarks';

export function createHighlightsApi(client: ApiClient = apiClient) {
  return {
    async listByBookmark(bookmarkId: string): Promise<HighlightListResponse> {
      return client.get(`/bookmarks/${encodeURIComponent(bookmarkId)}/highlights`, {
        schema: highlightListResponseSchema,
      });
    },

    async create(bookmarkId: string, input: CreateHighlightRequest): Promise<Highlight> {
      return client.post(`/bookmarks/${encodeURIComponent(bookmarkId)}/highlights`, input, {
        schema: highlightSchema,
      });
    },

    async update(highlightId: string, input: UpdateHighlightRequest): Promise<Highlight> {
      return client.put(`/highlights/${encodeURIComponent(highlightId)}`, input, {
        schema: highlightSchema,
      });
    },

    async remove(highlightId: string): Promise<void> {
      await client.delete<void>(`/highlights/${encodeURIComponent(highlightId)}`);
    },
  };
}

export const highlightsApi = createHighlightsApi();
