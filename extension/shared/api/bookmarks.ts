// Bookmark API calls for the extension (subset used by the popup editor).
// Input/output types come from the generated OpenAPI schemas
// (shared/api-types.gen.ts) — no hand-written DTOs.

import { apiFetch, type ApiFetchOptions } from '../apiFetch';
import type { components } from '../api-types.gen';

export type Bookmark = components['schemas']['BookmarkDto'];
export type CreateBookmarkInput = components['schemas']['CreateBookmarkBodyDto'];
export type UpdateBookmarkInput = components['schemas']['UpdateBookmarkDto'];
export type TagUsage = components['schemas']['TagUsageDto'];
export type BookmarkCollectionRef = components['schemas']['BookmarkCollectionRefDto'];

type AuthOptions = Omit<ApiFetchOptions, 'accessToken'> & { accessToken: string };

/** Creates a bookmark; `collectionId` rides the quick-add ?collection= query. */
export async function createBookmark(
  baseUrl: string,
  input: CreateBookmarkInput,
  options: AuthOptions & { collectionId?: string | null },
): Promise<Bookmark> {
  const base = baseUrl.replace(/\/+$/, '');
  const url = options.collectionId
    ? `${base}/api/v1/bookmarks?collection=${encodeURIComponent(options.collectionId)}`
    : `${base}/api/v1/bookmarks`;
  const result = await apiFetch<Bookmark>(url, {
    method: 'POST',
    body: input,
    accessToken: options.accessToken,
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  });
  return result.data;
}

export async function updateBookmark(
  baseUrl: string,
  id: string,
  input: UpdateBookmarkInput,
  options: AuthOptions,
): Promise<Bookmark> {
  const result = await apiFetch<Bookmark>(
    `${baseUrl.replace(/\/+$/, '')}/api/v1/bookmarks/${encodeURIComponent(id)}`,
    { method: 'PUT', body: input, accessToken: options.accessToken, fetchImpl: options.fetchImpl },
  );
  return result.data;
}

export async function replaceBookmarkTags(
  baseUrl: string,
  id: string,
  tags: string[],
  options: AuthOptions,
): Promise<Bookmark> {
  const result = await apiFetch<Bookmark>(
    `${baseUrl.replace(/\/+$/, '')}/api/v1/bookmarks/${encodeURIComponent(id)}/tags`,
    {
      method: 'PUT',
      body: { tags },
      accessToken: options.accessToken,
      fetchImpl: options.fetchImpl,
    },
  );
  return result.data;
}

export async function replaceBookmarkCollections(
  baseUrl: string,
  id: string,
  collectionIds: string[],
  options: AuthOptions,
): Promise<{ collections: BookmarkCollectionRef[] }> {
  const result = await apiFetch<{ collections: BookmarkCollectionRef[] }>(
    `${baseUrl.replace(/\/+$/, '')}/api/v1/bookmarks/${encodeURIComponent(id)}/collections`,
    {
      method: 'PUT',
      body: { collectionIds },
      accessToken: options.accessToken,
      fetchImpl: options.fetchImpl,
    },
  );
  return result.data;
}

/** Moves the bookmark to the trash (204). */
export async function trashBookmark(
  baseUrl: string,
  id: string,
  options: AuthOptions,
): Promise<void> {
  await apiFetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/bookmarks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    accessToken: options.accessToken,
    fetchImpl: options.fetchImpl,
  });
}

/**
 * Finds a bookmark by exact URL. The list endpoint has no url param, so this
 * probes the `link:` search operator with the quoted URL and then filters for
 * an exact match client-side (the operator is a substring/prefix match).
 */
export async function findBookmarkByUrl(
  baseUrl: string,
  url: string,
  options: AuthOptions,
): Promise<Bookmark | null> {
  const base = baseUrl.replace(/\/+$/, '');
  const query = encodeURIComponent(`link:"${url}"`);
  const result = await apiFetch<{ items: Bookmark[] }>(`${base}/api/v1/bookmarks?search=${query}`, {
    accessToken: options.accessToken,
    fetchImpl: options.fetchImpl,
  });
  return result.data.items.find((bookmark) => bookmark.url === url) ?? null;
}

/** Lists the user's tags with usage counts (autocomplete source). */
export async function listTagUsage(baseUrl: string, options: AuthOptions): Promise<TagUsage[]> {
  const result = await apiFetch<TagUsage[]>(
    `${baseUrl.replace(/\/+$/, '')}/api/v1/bookmarks/tags`,
    { accessToken: options.accessToken, fetchImpl: options.fetchImpl },
  );
  return result.data;
}
