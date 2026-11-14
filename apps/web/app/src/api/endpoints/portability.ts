import { apiClient, type ApiClient, type BlobResponse } from '../client';
import {
  importSummarySchema,
  type ExportDataRequest,
  type HighlightsExportFormat,
  type ImportSummary,
} from '../schemas/portability';

export function createPortabilityApi(client: ApiClient = apiClient) {
  return {
    async importData(file: File, options?: { signal?: AbortSignal }): Promise<ImportSummary> {
      const formData = new FormData();
      formData.append('file', file, file.name);
      return client.post('/data/import', formData, {
        schema: importSummarySchema,
        signal: options?.signal,
      });
    },

    async exportData(
      input: ExportDataRequest,
      options?: { signal?: AbortSignal },
    ): Promise<BlobResponse> {
      return client.postBlob('/data/export', input, {
        signal: options?.signal,
      });
    },

    async exportBookmarkHighlights(
      bookmarkId: string,
      format: HighlightsExportFormat,
      options?: { signal?: AbortSignal },
    ): Promise<BlobResponse> {
      return client.getBlob(`/bookmarks/${encodeURIComponent(bookmarkId)}/highlights/export`, {
        query: { format },
        signal: options?.signal,
      });
    },
  };
}

export const portabilityApi = createPortabilityApi();
