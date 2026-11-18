// Silent quick-save: active tab → find by URL (duplicates always insert, D13,
// so the lookup is mandatory) → POST via the quick-add query. The destination
// comes from the vault settings: "last-used" collection or unsorted.

import { createBookmark, findBookmarkByUrl, type Bookmark } from './api/bookmarks';
import type { VaultSettings } from './vault';
import type { TabContext } from './tabContext';

export interface QuickSaveDeps {
  baseUrl: string;
  accessToken: string;
  settings: VaultSettings;
  tab: TabContext;
  fetchImpl?: typeof fetch;
  /** Called when a save lands in a concrete collection (updates "last used"). */
  onSavedToCollection?: (collectionId: string) => Promise<void>;
}

export type QuickSaveResult =
  { status: 'saved'; bookmark: Bookmark } | { status: 'already-saved'; bookmark: Bookmark };

const MAX_TITLE = 512;

export async function quickSave(deps: QuickSaveDeps): Promise<QuickSaveResult> {
  const existing = await findBookmarkByUrl(deps.baseUrl, deps.tab.url, {
    accessToken: deps.accessToken,
    fetchImpl: deps.fetchImpl,
  });
  if (existing) {
    return { status: 'already-saved', bookmark: existing };
  }

  const collectionId =
    deps.settings.quickSaveTarget === 'last-used'
      ? deps.settings.lastUsedCollectionId
      : deps.settings.quickSaveTarget === 'collection'
        ? deps.settings.quickSaveCollectionId
        : null;

  const bookmark = await createBookmark(
    deps.baseUrl,
    {
      url: deps.tab.url,
      title: deps.tab.title.slice(0, MAX_TITLE),
      favorite: false,
    },
    {
      accessToken: deps.accessToken,
      fetchImpl: deps.fetchImpl,
      collectionId,
    },
  );

  if (collectionId && deps.onSavedToCollection) {
    await deps.onSavedToCollection(collectionId);
  }
  return { status: 'saved', bookmark };
}
