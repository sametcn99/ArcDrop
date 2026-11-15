import { apiClient, type ApiClient } from '../client';
import type { ConfirmPasswordRequest } from '../schemas/account';
import type { operations } from '../types';

/**
 * Self-service account lifecycle (API plan M15). Both calls are
 * password-confirmed, strictly throttled server-side (10/min), and return
 * 204 No Content on success. Personal access tokens cannot reach these
 * routes — the web client always calls them with a session token.
 */
export function createAccountApi(client: ApiClient = apiClient) {
  return {
    /**
     * Wipes bookmarks, collections, tags, highlights, notifications, and
     * change events; keeps the profile, settings, and sessions. The server
     * change-log sequence resets to 0.
     */
    async resetLibrary(input: ConfirmPasswordRequest): Promise<void> {
      await client.post<void>('/me/reset-data', input);
    },

    /** Deletes the account with all owned data (409 for the last active admin). */
    async deleteAccount(input: ConfirmPasswordRequest): Promise<void> {
      // `client.delete` accepts `body` in its options (unlike `get`).
      await client.delete<void>('/me', { body: input });
    },
  };
}

export const accountApi = createAccountApi();

// Compile-time operation-name alignment against the generated OpenAPI paths.
type _AccountPathsCheck = [
  operations['resetOwnData'] extends never ? never : true,
  operations['deleteOwnAccount'] extends never ? never : true,
];
void (undefined as _AccountPathsCheck | undefined);
