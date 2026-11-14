import { apiClient, type ApiClient } from '../client';
import {
  duplicateGroupsResponseSchema,
  resolveDuplicatesResponseSchema,
  type DuplicateGroupsResponse,
  type ResolveDuplicatesRequest,
  type ResolveDuplicatesResponse,
} from '../schemas/health';

export function createHealthApi(client: ApiClient = apiClient) {
  return {
    async findDuplicates(): Promise<DuplicateGroupsResponse> {
      return client.get('/library/duplicates', {
        schema: duplicateGroupsResponseSchema,
      });
    },

    async resolveDuplicates(input: ResolveDuplicatesRequest): Promise<ResolveDuplicatesResponse> {
      return client.post('/library/duplicates/resolve', input, {
        schema: resolveDuplicatesResponseSchema,
      });
    },
  };
}

export const healthApi = createHealthApi();
