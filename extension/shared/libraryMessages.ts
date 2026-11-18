// Message protocol for the popup editor ↔ background library broker
// (bookmarks, collections, tags, quick-save, page meta). Responses are plain
// serializable objects; types reference the shared API modules.

import type { Bookmark, TagUsage } from './api/bookmarks';
import type { Collection, CollectionNode } from './api/collections';
import type { BrokerFailure } from './brokerTypes';
import type { PageMetaCandidates } from './pageImages';
import type { QuickSaveResult } from './quicksave';

/** What the editor submits for one save. `collectionId: null` = unsorted. */
export interface SaveDraft {
  url: string;
  title: string;
  excerpt: string;
  favorite: boolean;
  collectionId: string | null;
  tags: string[];
}

export type LibraryBrokerRequest =
  | { type: 'library/find-by-url'; url: string }
  | {
      type: 'library/save';
      draft: SaveDraft;
      existingId: string | null;
      collectionTouched: boolean;
    }
  | { type: 'library/trash'; id: string }
  | { type: 'library/collections' }
  | { type: 'library/create-collection'; title: string; parentId: string | null }
  | { type: 'library/tags' }
  | { type: 'library/page-meta'; tabId: number }
  | { type: 'library/quick-save' };

export type LibraryBrokerResponse =
  | { ok: true; kind: 'found'; bookmark: Bookmark | null }
  | { ok: true; kind: 'saved'; bookmark: Bookmark }
  | { ok: true; kind: 'trashed' }
  | { ok: true; kind: 'collections'; nodes: CollectionNode[] }
  | { ok: true; kind: 'collection-created'; collection: Collection }
  | { ok: true; kind: 'tags'; usage: TagUsage[] }
  | { ok: true; kind: 'page-meta'; meta: PageMetaCandidates | null }
  | { ok: true; kind: 'quick-saved'; result: QuickSaveResult }
  | BrokerFailure;

export type LibraryResponse = Extract<LibraryBrokerResponse, { ok: true }> | BrokerFailure;

export async function sendLibraryMessage(message: LibraryBrokerRequest): Promise<LibraryResponse> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (
    typeof response !== 'object' ||
    response === null ||
    typeof (response as Record<string, unknown>)['ok'] !== 'boolean'
  ) {
    throw new Error('Invalid library broker response');
  }
  return response as LibraryResponse;
}
