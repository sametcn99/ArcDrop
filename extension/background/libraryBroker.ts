// Library broker: server calls for the popup editor (bookmarks, collections,
// tags, quick-save) plus the badge feedback. Like the auth broker, it is the
// single background writer for its concerns; the popup only sends messages.
// Every server call goes out with an access token from the auth broker.

import * as bookmarksApi from '../shared/api/bookmarks';
import * as collectionsApi from '../shared/api/collections';
import { chromeBadgeWriter, createBadgeManager, type BadgeManager } from '../shared/badge';
import { isApiError } from '../shared/problem';
import { collectPageMeta, type PageMetaCandidates } from '../shared/pageImages';
import {
  dedupeTabs,
  filenameFromImageUrl,
  appendSelectionToExcerpt,
  deriveLinkTitle,
  isHttpUrl,
  summarizeSaveOutcomes,
  type DedupedTabs,
  type SaveOutcome,
} from '../shared/menuActions';
import type { PendingImageSave } from '../shared/libraryMessages';
import {
  hasOriginPermission,
  requestOriginPermission,
  type PermissionsLike,
} from '../shared/hostPermissions';
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

/** Minimal chrome.storage.session shape (pending-permission stash). */
export interface SessionAreaLike {
  get(keys?: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

const PENDING_IMAGE_KEY = 'pendingImageSave';

export interface LibraryBrokerDeps {
  area: StorageLike;
  /** Access token supplier — the auth broker's single-flight getter. */
  getAccessToken: () => Promise<string>;
  badge?: BadgeManager;
  tabs?: TabsLike;
  scripting?: ScriptingLike;
  fetchImpl?: typeof fetch;
  permissions?: PermissionsLike;
  sessionArea?: SessionAreaLike;
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
  // E5 toggle: the options "Show badge feedback" switch (vault consult).
  const showBadgeFor = (
    vault: { settings: { badgeEnabled: boolean } } | null,
    state: Parameters<BadgeManager['show']>[0],
    tabId?: number,
  ): void => {
    if (vault?.settings.badgeEnabled !== false) {
      badge.show(state, tabId);
    }
  };
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

    showBadgeFor(vault, 'saving', tab.tabId);
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
      showBadgeFor(vault, 'saved', tab.tabId);
      return result;
    } catch (error) {
      showBadgeFor(vault, 'failed', tab.tabId);
      throw error;
    }
  }

  // ---- E4: context-menu + bulk flows ------------------------------------

  async function listSavableTabs(): Promise<DedupedTabs> {
    const results = await tabs.query({ url: ['http://*/*', 'https://*/*'] });
    return dedupeTabs(results.map((tab) => ({ url: tab.url ?? '', title: tab.title ?? '' })));
  }

  async function saveAllTabs(
    collectionId: string | null,
  ): Promise<ReturnType<typeof summarizeSaveOutcomes>> {
    const vault = await readVault(area);
    if (!vault.baseUrl) {
      throw new Error('Not connected to a server yet.');
    }
    const { unique, duplicatesRemoved } = await listSavableTabs();
    showBadgeFor(vault, 'saving');

    const accessToken = await deps.getAccessToken();
    const auth = { accessToken, fetchImpl };
    const outcomes: SaveOutcome[] = [];
    const CONCURRENCY = 4;
    let cursor = 0;

    const runNext = async (): Promise<void> => {
      while (cursor < unique.length) {
        const item = unique[cursor];
        cursor += 1;
        if (!item) continue;
        try {
          const existing = await bookmarksApi.findBookmarkByUrl(vault.baseUrl!, item.url, auth);
          if (existing) {
            outcomes.push({ status: 'already-saved', url: item.url });
            continue;
          }
          await bookmarksApi.createBookmark(
            vault.baseUrl!,
            { url: item.url, title: item.title.slice(0, MAX_TITLE), favorite: false },
            { ...auth, collectionId: collectionId ?? undefined },
          );
          outcomes.push({ status: 'saved', url: item.url });
        } catch {
          outcomes.push({ status: 'failed', url: item.url });
        }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => runNext()));
    if (collectionId) {
      await writeVault(area, {
        settings: { ...vault.settings, lastUsedCollectionId: collectionId },
      });
    }
    const summary = summarizeSaveOutcomes(outcomes, duplicatesRemoved);
    badge.show(summary.failed === outcomes.length && outcomes.length > 0 ? 'failed' : 'saved');
    return summary;
  }

  async function readPendingImage(): Promise<PendingImageSave | null> {
    if (!deps.sessionArea) return null;
    const stored = await deps.sessionArea.get(PENDING_IMAGE_KEY);
    const pending = stored[PENDING_IMAGE_KEY];
    if (typeof pending !== 'object' || pending === null) return null;
    const candidate = pending as {
      origin?: unknown;
      srcUrl?: unknown;
      pageTitle?: unknown;
      savedAt?: unknown;
    };
    if (typeof candidate['origin'] !== 'string' || typeof candidate['srcUrl'] !== 'string') {
      return null;
    }
    return {
      origin: candidate['origin'],
      srcUrl: candidate['srcUrl'],
      pageTitle: typeof candidate['pageTitle'] === 'string' ? candidate['pageTitle'] : undefined,
      savedAt: typeof candidate['savedAt'] === 'number' ? candidate['savedAt'] : 0,
    };
  }

  async function clearPendingImage(): Promise<void> {
    if (!deps.sessionArea) return;
    await deps.sessionArea.remove(PENDING_IMAGE_KEY);
  }

  /**
   * Fetches + uploads an image (POST /bookmarks/file). The source origin
   * needs a host permission — granted inline when the caller carries a user
   * gesture, otherwise stashed for the popup ("Grant access" banner).
   */
  async function saveImage(srcUrl: string, pageTitle?: string): Promise<LibraryBrokerResponse> {
    const vault = await readVault(area);
    if (!vault.baseUrl) {
      throw new Error('Not connected to a server yet.');
    }
    let origin: string;
    try {
      origin = new URL(srcUrl).origin;
    } catch {
      return failure('VALIDATION', 'Invalid image URL.');
    }

    const permissions = deps.permissions;
    let granted = permissions ? await hasOriginPermission(permissions, origin) : true;
    if (!granted) {
      if (permissions) {
        // Works when the caller carries a user gesture (menu click); a
        // gesture-less background rejects the prompt outright.
        try {
          granted = await requestOriginPermission(permissions, origin);
        } catch {
          granted = false;
        }
      }
      if (!granted) {
        if (deps.sessionArea) {
          await deps.sessionArea.set({
            [PENDING_IMAGE_KEY]: {
              origin,
              srcUrl,
              pageTitle,
              savedAt: Date.now(),
            } satisfies PendingImageSave,
          });
          showBadgeFor(vault, 'failed');
          return failure(
            'HOST_PERMISSION_REQUIRED',
            `Grant access to ${origin} from the ArcDrop popup to save this image.`,
          );
        }
        return failure('HOST_PERMISSION_DENIED', `No access to ${origin}.`);
      }
    }

    showBadgeFor(vault, 'saving');
    try {
      const accessToken = await deps.getAccessToken();
      const response = await fetchImpl(srcUrl);
      if (!response.ok) {
        throw new Error(`Image fetch failed with HTTP ${response.status}`);
      }
      const mime =
        (response.headers.get('content-type') ?? 'image/png').split(';')[0]?.trim() ?? 'image/png';
      if (mime === 'image/svg+xml') {
        // The API refuses scripted formats (file-types.ts).
        showBadgeFor(vault, 'failed');
        return failure('UNSUPPORTED_IMAGE', 'SVG images cannot be saved as files.');
      }
      const blob = await response.blob();
      const file = new File([blob], filenameFromImageUrl(srcUrl, mime), { type: mime });
      const bookmark = await bookmarksApi.uploadBookmarkImage(
        vault.baseUrl,
        file,
        { title: pageTitle?.slice(0, MAX_TITLE) },
        { accessToken, fetchImpl },
      );
      showBadgeFor(vault, 'saved');
      return { ok: true, kind: 'saved', bookmark };
    } catch (error) {
      showBadgeFor(vault, 'failed');
      throw error;
    }
  }

  async function saveSelection(
    selectionText: string,
    pageUrl?: string,
    pageTitle?: string,
  ): Promise<LibraryBrokerResponse> {
    const vault = await readVault(area);
    if (!vault.baseUrl) {
      throw new Error('Not connected to a server yet.');
    }
    const pageUrlValue = pageUrl ?? '';
    if (!isHttpUrl(pageUrlValue)) {
      return failure('VALIDATION', 'This page cannot be saved.');
    }
    const accessToken = await deps.getAccessToken();
    const auth = { accessToken, fetchImpl };
    showBadgeFor(vault, 'saving');

    const existing = await bookmarksApi.findBookmarkByUrl(vault.baseUrl, pageUrlValue, auth);
    if (existing) {
      // Append to the saved page's description (idempotent on repeats).
      const { excerpt, changed } = appendSelectionToExcerpt(existing.excerpt, selectionText);
      if (changed) {
        await bookmarksApi.updateBookmark(vault.baseUrl, existing.id, { excerpt }, auth);
      }
      showBadgeFor(vault, 'saved');
      return { ok: true, kind: 'done' };
    }

    await bookmarksApi.createBookmark(
      vault.baseUrl,
      {
        url: pageUrlValue,
        title: pageTitle?.slice(0, MAX_TITLE),
        excerpt: selectionText.trim().slice(0, MAX_EXCERPT) || undefined,
        favorite: false,
      },
      auth,
    );
    showBadgeFor(vault, 'saved');
    return { ok: true, kind: 'done' };
  }

  async function saveLink(linkUrl: string, title?: string): Promise<LibraryBrokerResponse> {
    const vault = await readVault(area);
    if (!vault.baseUrl) {
      throw new Error('Not connected to a server yet.');
    }
    if (!isHttpUrl(linkUrl)) {
      return failure('VALIDATION', 'This link cannot be saved.');
    }
    const accessToken = await deps.getAccessToken();
    const auth = { accessToken, fetchImpl };
    showBadgeFor(vault, 'saving');

    const existing = await bookmarksApi.findBookmarkByUrl(vault.baseUrl, linkUrl, auth);
    if (existing) {
      showBadgeFor(vault, 'saved');
      return { ok: true, kind: 'done' };
    }
    await bookmarksApi.createBookmark(
      vault.baseUrl,
      { url: linkUrl, title: deriveLinkTitle(linkUrl, title).slice(0, MAX_TITLE), favorite: false },
      auth,
    );
    showBadgeFor(vault, 'saved');
    return { ok: true, kind: 'done' };
  }

  async function handleMessageInner(message: unknown): Promise<LibraryBrokerResponse> {
    if (typeof message !== 'object' || message === null) {
      return failure('INVALID_MESSAGE', 'Unknown request.');
    }
    const type = (message as { type?: unknown })['type'];
    if (typeof type !== 'string' || !type.startsWith('library/')) {
      return failure('INVALID_MESSAGE', 'Unknown request type.');
    }

    // Offline-safe requests: they need neither a configured server nor a
    // token (the tab list is local; the pending stash is session storage).
    if (type === 'library/list-savable-tabs') {
      const { unique, duplicatesRemoved } = await listSavableTabs();
      return { ok: true, kind: 'savable-tabs', tabs: unique, duplicatesRemoved };
    }
    if (type === 'library/pending-permission') {
      const pending = await readPendingImage();
      return { ok: true, kind: 'pending-permission', pending };
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
        showBadgeFor(vault, 'saving');

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
        showBadgeFor(vault, 'saved');
        return { ok: true, kind: 'saved', bookmark };
      }
      case 'library/trash': {
        const id = (message as { id?: unknown })['id'];
        if (typeof id !== 'string') {
          return failure('VALIDATION', 'Missing bookmark id.');
        }
        await bookmarksApi.trashBookmark(vault.baseUrl, id, auth);
        showBadgeFor(vault, 'saved');
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
      case 'library/save-link': {
        const body = message as { linkUrl?: unknown; title?: unknown };
        if (typeof body['linkUrl'] !== 'string') {
          return failure('VALIDATION', 'Missing link URL.');
        }
        return saveLink(
          body['linkUrl'],
          typeof body['title'] === 'string' ? body['title'] : undefined,
        );
      }
      case 'library/save-selection': {
        const body = message as {
          selectionText?: unknown;
          pageUrl?: unknown;
          pageTitle?: unknown;
        };
        if (typeof body['selectionText'] !== 'string') {
          return failure('VALIDATION', 'Missing selection.');
        }
        return saveSelection(
          body['selectionText'],
          typeof body['pageUrl'] === 'string' ? body['pageUrl'] : undefined,
          typeof body['pageTitle'] === 'string' ? body['pageTitle'] : undefined,
        );
      }
      case 'library/save-image': {
        const body = message as { srcUrl?: unknown; pageTitle?: unknown };
        if (typeof body['srcUrl'] !== 'string') {
          return failure('VALIDATION', 'Missing image URL.');
        }
        return saveImage(
          body['srcUrl'],
          typeof body['pageTitle'] === 'string' ? body['pageTitle'] : undefined,
        );
      }
      case 'library/list-savable-tabs':
        // Handled above (offline-safe); unreachable.
        return { ok: true, kind: 'savable-tabs', tabs: [], duplicatesRemoved: 0 };
      case 'library/save-all-tabs': {
        const collectionId = (message as { collectionId?: unknown })['collectionId'];
        const summary = await saveAllTabs(
          typeof collectionId === 'string' && collectionId.length > 0 ? collectionId : null,
        );
        return { ok: true, kind: 'save-all-summary', summary };
      }
      case 'library/pending-permission':
        // Handled above (offline-safe); unreachable.
        return { ok: true, kind: 'pending-permission', pending: null };
      case 'library/complete-pending-image': {
        // Popup-driven (real user gesture): grant + finish the stashed save.
        const pending = await readPendingImage();
        if (!pending) {
          return failure('VALIDATION', 'Nothing pending.');
        }
        const saved = await saveImage(pending.srcUrl, pending.pageTitle);
        await clearPendingImage();
        return saved;
      }
      case 'library/set-cover': {
        // E7 cover picker: the SERVER fetches the image (SSRF pipeline) —
        // the extension never touches the image origin itself.
        const body = message as { bookmarkId?: unknown; imageUrl?: unknown };
        if (typeof body['bookmarkId'] !== 'string' || typeof body['imageUrl'] !== 'string') {
          return failure('VALIDATION', 'Missing bookmark id or image URL.');
        }
        showBadgeFor(vault, 'saving');
        try {
          const bookmark = await bookmarksApi.setBookmarkCover(
            vault.baseUrl,
            body['bookmarkId'],
            body['imageUrl'],
            auth,
          );
          showBadgeFor(vault, 'saved');
          return { ok: true, kind: 'cover-assigned', bookmark };
        } catch (error) {
          showBadgeFor(vault, 'failed');
          throw error;
        }
      }
      default:
        return failure('INVALID_MESSAGE', 'Unknown request type.');
    }
  }

  return {
    // ApiErrors become failure responses carrying the problem details (same
    // shape as the auth broker); anything else surfaces as BROKER_CRASH.
    handleMessage: (message: unknown): Promise<LibraryBrokerResponse> =>
      handleMessageInner(message).catch(async (error: unknown) => {
        const vault = await readVault(area).catch(() => null);
        showBadgeFor(vault, 'failed');
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
