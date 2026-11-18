// Message protocol for the popup editor ↔ background library broker
// (bookmarks, collections, tags, quick-save, page meta). Responses are plain
// serializable objects; types reference the shared API modules.

import type { Bookmark, TagUsage } from './api/bookmarks';
import type { Collection, CollectionNode } from './api/collections';
import type { BrokerFailure } from './brokerTypes';
import type { PageMetaCandidates } from './pageImages';
import type { QuickSaveResult } from './quicksave';
import type { SaveAllSummary, TabItem } from './menuActions';

/**
 * An image save blocked on a one-time origin permission — stashed in
 * chrome.storage.session so the popup can re-drive it with a real user
 * gesture (background menu clicks may not carry one).
 */
export interface PendingImageSave {
  origin: string;
  srcUrl: string;
  pageTitle?: string;
  savedAt: number;
}

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
  | { type: 'library/quick-save' }
  // E4 context-menu + bulk flows (background-driven; badge feedback included)
  | { type: 'library/save-link'; linkUrl: string; title?: string }
  | { type: 'library/save-selection'; selectionText: string; pageUrl?: string; pageTitle?: string }
  | { type: 'library/save-image'; srcUrl: string; pageUrl?: string; pageTitle?: string }
  | { type: 'library/list-savable-tabs' }
  | { type: 'library/save-all-tabs'; collectionId: string | null }
  | { type: 'library/pending-permission' }
  | { type: 'library/complete-pending-image' }
  // E7 cover picker (plan E7): server-side fetch, no extra origin permission
  | { type: 'library/set-cover'; bookmarkId: string; imageUrl: string };

export type LibraryBrokerResponse =
  | { ok: true; kind: 'found'; bookmark: Bookmark | null }
  | { ok: true; kind: 'saved'; bookmark: Bookmark }
  | { ok: true; kind: 'trashed' }
  | { ok: true; kind: 'collections'; nodes: CollectionNode[] }
  | { ok: true; kind: 'collection-created'; collection: Collection }
  | { ok: true; kind: 'tags'; usage: TagUsage[] }
  | { ok: true; kind: 'page-meta'; meta: PageMetaCandidates | null }
  | { ok: true; kind: 'quick-saved'; result: QuickSaveResult }
  | { ok: true; kind: 'done' }
  | { ok: true; kind: 'cover-assigned'; bookmark: Bookmark }
  | { ok: true; kind: 'savable-tabs'; tabs: TabItem[]; duplicatesRemoved: number }
  | { ok: true; kind: 'save-all-summary'; summary: SaveAllSummary }
  | { ok: true; kind: 'pending-permission'; pending: PendingImageSave | null }
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
