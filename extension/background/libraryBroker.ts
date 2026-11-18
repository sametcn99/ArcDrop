// Library broker: server calls for the popup editor (bookmarks, collections,
// tags, quick-save) plus the badge feedback. Like the auth broker, it is the
// single background writer for its concerns; the popup only sends messages.
// Every server call goes out with an access token from the auth broker.

import * as bookmarksApi from '../shared/api/bookmarks';
import * as collectionsApi from '../shared/api/collections';
import { chromeBadgeWriter, createBadgeManager, type BadgeManager } from '../shared/badge';
import { isApiError } from '../shared/problem';
import { collectPageMeta, type PageMetaCandidates } from '../shared/pageImages';
import { quickSave, type QuickSaveResult } from '../shared/quicksave';
import {
  getActiveTabContext,
  chromeTabs,
  type TabContext,
  type TabsLike,
} from '../shared/tabContext';
import { readVault, writeVault, type StorageLike } from '../shared/vault';
import type {
  LibraryBrokerRequest,
  LibraryBrokerResponse,
  SaveDraft,
} from '../shared/libraryMessages';

const MAX_TITLE = 512;
const MAX_EXCERPT = 2000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 100;

export interface ScriptingLike {
  executeScript(details: {
    target: { tabId: number };
    func: () => unknown;
  }): Promise<Array<{ result?: unknown }>>;
}

function chromeScripting(): ScriptingLike {
  return chrome.scripting;
}

export interface LibraryBrokerDeps {
  area: StorageLike;
  /** Access token supplier — the auth broker's single-flight getter. */
  getAccessToken: () => Promise<string>;
  badge?: BadgeManager;
  tabs?: TabsLike;
  scripting?: ScriptingLike;
  fetchImpl?: typeof fetch;
}

function failure(code: string, message: string): Extract<LibraryBrokerResponse, { ok: false }> {
  return { ok: false, code, message };
}

function normalizeDraft(draft: SaveDraft): SaveDraft {
  return {
    url: draft.url,
    title: draft.title.trim().slice(0, MAX_TITLE),
    excerpt: draft.excerpt.trim().slice(0, MAX_EXCERPT),
    favorite: draft.favorite,
    collectionId: draft.collectionId,
    tags: Array.from(
      new Set(
        draft.tags
          .map((tag) => tag.trim().slice(0, MAX_TAG_LENGTH))
          .filter((tag) => tag.length > 0),
      ),
    ).slice(0, MAX_TAGS),
  };
}

export function createLibraryBroker(deps: LibraryBrokerDeps) {
  const { area } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const badge: BadgeManager = deps.badge ?? createBadgeManager(chromeBadgeWriter());
  const tabs: TabsLike = deps.tabs ?? chromeTabs();
  const scripting: ScriptingLike = deps.scripting ?? chromeScripting();

  async function pageMeta(tabId: number): Promise<PageMetaCandidates | null> {
    try {
      const results = await scripting.executeScript({
        target: { tabId },
        func: collectPageMeta,
      });
      const meta = results[0]?.result;
      if (
        typeof meta !== 'object' ||
        meta === null ||
        !('images' in (meta as Record<string, unknown>))
      ) {
        return null;
      }
      return meta as PageMetaCandidates;
    } catch {
      // Restricted pages, discarded tabs, missing host access — no meta.
      return null;
    }
  }

  /** Popup button + keyboard command share this path (badge included). */
  async function quickSaveActiveTab(): Promise<QuickSaveResult> {
    const vault = await readVault(area);
    if (!vault.baseUrl) {
      throw new Error('Not connected to a server yet.');
    }
    const tab: TabContext | null = await getActiveTabContext(tabs);
    if (!tab) {
      throw new Error('The current page cannot be saved.');
    }

    badge.show('saving', tab.tabId);
    try {
      const accessToken = await deps.getAccessToken();
      const result = await quickSave({
        baseUrl: vault.baseUrl,
        accessToken,
        settings: vault.settings,
        tab,
        fetchImpl,
        onSavedToCollection: async (collectionId) => {
          await writeVault(area, {
            settings: { ...vault.settings, lastUsedCollectionId: collectionId },
          });
        },
      });
      badge.show('saved', tab.tabId);
      return result;
    } catch (error) {
      badge.show('failed', tab.tabId);
      throw error;
    }
  }

  async function handleMessageInner(message: unknown): Promise<LibraryBrokerResponse> {
    if (typeof message !== 'object' || message === null) {
      return failure('INVALID_MESSAGE', 'Unknown request.');
    }
    const type = (message as { type?: unknown })['type'];
    if (typeof type !== 'string' || !type.startsWith('library/')) {
      return failure('INVALID_MESSAGE', 'Unknown request type.');
    }

    const vault = await readVault(area);
    if (!vault.baseUrl) {
      return failure('SESSION_EXPIRED', 'No server configured yet.');
    }
    const accessToken = await deps.getAccessToken();
    const auth = { accessToken, fetchImpl };

    switch (type as LibraryBrokerRequest['type']) {
      case 'library/find-by-url': {
        const url = (message as { url?: unknown })['url'];
        if (typeof url !== 'string') {
          return failure('VALIDATION', 'Missing URL.');
        }
        const bookmark = await bookmarksApi.findBookmarkByUrl(vault.baseUrl, url, auth);
        return { ok: true, kind: 'found', bookmark };
      }
      case 'library/save': {
        const body = message as {
          draft?: unknown;
          existingId?: unknown;
          collectionTouched?: unknown;
        };
        if (typeof body['draft'] !== 'object' || body['draft'] === null) {
          return failure('VALIDATION', 'Missing draft.');
        }
        const draft = normalizeDraft(body['draft'] as SaveDraft);
        const existingId = typeof body['existingId'] === 'string' ? body['existingId'] : null;
        const collectionTouched = body['collectionTouched'] === true;
        badge.show('saving');

        let bookmark;
        if (existingId) {
          bookmark = await bookmarksApi.updateBookmark(
            vault.baseUrl,
            existingId,
            {
              title: draft.title.length > 0 ? draft.title : null,
              excerpt: draft.excerpt.length > 0 ? draft.excerpt : null,
              favorite: draft.favorite,
            },
            auth,
          );
          // The API has no read surface for current memberships, so the
          // collections are only replaced when the picker was touched —
          // otherwise the existing membership is left untouched.
          if (collectionTouched) {
            await bookmarksApi.replaceBookmarkCollections(
              vault.baseUrl,
              existingId,
              draft.collectionId ? [draft.collectionId] : [],
              auth,
            );
          }
        } else {
          bookmark = await bookmarksApi.createBookmark(
            vault.baseUrl,
            {
              url: draft.url,
              title: draft.title.length > 0 ? draft.title : undefined,
              excerpt: draft.excerpt.length > 0 ? draft.excerpt : undefined,
              favorite: draft.favorite,
            },
            { ...auth, collectionId: draft.collectionId },
          );
        }
        await bookmarksApi.replaceBookmarkTags(vault.baseUrl, bookmark.id, draft.tags, auth);

        if (draft.collectionId) {
          await writeVault(area, {
            settings: {
              ...vault.settings,
              lastUsedCollectionId: draft.collectionId,
            },
          });
        }
        badge.show('saved');
        return { ok: true, kind: 'saved', bookmark };
      }
      case 'library/trash': {
        const id = (message as { id?: unknown })['id'];
        if (typeof id !== 'string') {
          return failure('VALIDATION', 'Missing bookmark id.');
        }
        await bookmarksApi.trashBookmark(vault.baseUrl, id, auth);
        badge.show('saved');
        return { ok: true, kind: 'trashed' };
      }
      case 'library/collections': {
        const nodes = await collectionsApi.fetchCollectionTree(vault.baseUrl, auth);
        return { ok: true, kind: 'collections', nodes };
      }
      case 'library/create-collection': {
        const body = message as { title?: unknown; parentId?: unknown };
        if (typeof body['title'] !== 'string' || body['title'].trim().length === 0) {
          return failure('VALIDATION', 'Collection title is required.');
        }
        const collection = await collectionsApi.createCollection(
          vault.baseUrl,
          {
            title: body['title'].trim().slice(0, 255),
            ...(typeof body['parentId'] === 'string' ? { parentId: body['parentId'] } : {}),
          },
          auth,
        );
        return { ok: true, kind: 'collection-created', collection };
      }
      case 'library/tags': {
        const usage = await bookmarksApi.listTagUsage(vault.baseUrl, auth);
        return { ok: true, kind: 'tags', usage };
      }
      case 'library/page-meta': {
        const tabId = (message as { tabId?: unknown })['tabId'];
        if (typeof tabId !== 'number') {
          return failure('VALIDATION', 'Missing tab id.');
        }
        const meta = await pageMeta(tabId);
        return { ok: true, kind: 'page-meta', meta };
      }
      case 'library/quick-save': {
        const result = await quickSaveActiveTab();
        return { ok: true, kind: 'quick-saved', result };
      }
      default:
        return failure('INVALID_MESSAGE', 'Unknown request type.');
    }
  }

  return {
    // ApiErrors become failure responses carrying the problem details (same
    // shape as the auth broker); anything else surfaces as BROKER_CRASH.
    handleMessage: (message: unknown): Promise<LibraryBrokerResponse> =>
      handleMessageInner(message).catch((error: unknown) => {
        badge.show('failed');
        if (isApiError(error)) {
          return {
            ok: false,
            code: error.code,
            message: error.detail.length > 0 ? error.detail : error.title,
            status: error.status > 0 ? error.status : undefined,
            requestId: error.requestId,
            retryAfterSeconds: error.retryAfterSeconds,
            challenge: error.challenge,
            expiresAt: error.expiresAt,
          };
        }
        return {
          ok: false,
          code: 'BROKER_CRASH',
          message: error instanceof Error ? error.message : 'Unexpected library failure.',
        };
      }),
    quickSaveActiveTab,
  };
}

export type LibraryBroker = ReturnType<typeof createLibraryBroker>;
