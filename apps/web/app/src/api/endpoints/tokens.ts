import { apiClient, type ApiClient } from '../client';
import {
  createdPersonalAccessTokenSchema,
  personalAccessTokenListSchema,
  type CreatePersonalAccessTokenInput,
  type CreatedPersonalAccessToken,
  type PersonalAccessToken,
} from '../schemas/tokens';

export function createTokensApi(client: ApiClient = apiClient) {
  return {
    async list(): Promise<PersonalAccessToken[]> {
      const result = await client.get('/me/tokens', {
        schema: personalAccessTokenListSchema,
      });
      return result.items;
    },

    async create(input: CreatePersonalAccessTokenInput): Promise<CreatedPersonalAccessToken> {
      return client.post('/me/tokens', input, {
        schema: createdPersonalAccessTokenSchema,
      });
    },

    async revoke(tokenId: string): Promise<void> {
      await client.delete<void>(`/me/tokens/${encodeURIComponent(tokenId)}`);
    },
  };
}

export const tokensApi = createTokensApi();
