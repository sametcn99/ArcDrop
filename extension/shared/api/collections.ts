// Collection API calls for the extension (tree picker + inline create).

import { apiFetch, type ApiFetchOptions } from '../apiFetch';
import type { components } from '../api-types.gen';

export type Collection = components['schemas']['CollectionDto'];
export type CollectionNode = components['schemas']['CollectionNodeDto'];
export type CreateCollectionInput = components['schemas']['CreateCollectionDto'];

type AuthOptions = Omit<ApiFetchOptions, 'accessToken'> & { accessToken: string };

/** The nested collection tree (active collections only). */
export async function fetchCollectionTree(
  baseUrl: string,
  options: AuthOptions,
): Promise<CollectionNode[]> {
  const result = await apiFetch<CollectionNode[]>(
    `${baseUrl.replace(/\/+$/, '')}/api/v1/collections/tree`,
    { accessToken: options.accessToken, fetchImpl: options.fetchImpl },
  );
  return result.data;
}

export async function createCollection(
  baseUrl: string,
  input: CreateCollectionInput,
  options: AuthOptions,
): Promise<Collection> {
  const result = await apiFetch<Collection>(`${baseUrl.replace(/\/+$/, '')}/api/v1/collections`, {
    method: 'POST',
    body: input,
    accessToken: options.accessToken,
    fetchImpl: options.fetchImpl,
  });
  return result.data;
}
