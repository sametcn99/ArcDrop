import { apiClient, type ApiClient } from '../client';
import {
  publicCollectionPageSchema,
  type PublicCollectionPage,
} from '../schemas/publicShare';

export function createPublicShareApi(client: ApiClient = apiClient) {
  return {
    async getPublicCollection(
      shareToken: string,
      page = 0,
      pageSize = 50,
    ): Promise<PublicCollectionPage> {
      return client.get(`/public/collections/${encodeURIComponent(shareToken)}`, {
        schema: publicCollectionPageSchema,
        skipAuth: true,
        query: { page, pageSize },
      });
    },

    rssUrl(shareToken: string): string {
      return client.resolveUrl(
        `/public/collections/${encodeURIComponent(shareToken)}/rss`,
      );
    },
  };
}

export const publicShareApi = createPublicShareApi();
