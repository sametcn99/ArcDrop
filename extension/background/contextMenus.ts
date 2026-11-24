// E4 context menus. Registration happens on install/update (menus persist
// across service-worker restarts); clicks are dispatched by background/index
// into the library broker, which drives the badge state machine.

import { strings } from '../shared/strings';

export type ContextMenuId =
  'arcdrop-save-page' | 'arcdrop-save-link' | 'arcdrop-save-image' | 'arcdrop-save-selection';

export interface ContextMenusLike {
  removeAll(): Promise<void>;
  create(details: Record<string, unknown>): unknown;
  onClicked: {
    addListener(
      callback: (info: {
        menuItemId: unknown;
        pageUrl?: string;
        linkUrl?: string;
        srcUrl?: string;
        selectionText?: string;
        tabId?: number;
      }) => void,
    ): void;
  };
}

export function chromeContextMenus(): ContextMenusLike {
  return chrome.contextMenus;
}

const MENU_IDS: Record<ContextMenuId, string> = {
  'arcdrop-save-page': strings.popup.menus.page,
  'arcdrop-save-link': strings.popup.menus.link,
  'arcdrop-save-image': strings.popup.menus.image,
  'arcdrop-save-selection': strings.popup.menus.selection,
};

export function registerContextMenus(menus: ContextMenusLike = chromeContextMenus()): void {
  void menus.removeAll().then(() => {
    for (const [id, title] of Object.entries(MENU_IDS)) {
      menus.create({
        id,
        title,
        // 'page' also covers the plain background; the specific contexts
        // take precedence in the click handler by menuItemId.
        contexts:
          id === 'arcdrop-save-page'
            ? ['page', 'frame', 'editable', 'video', 'audio']
            : id === 'arcdrop-save-selection'
              ? ['selection']
              : id === 'arcdrop-save-link'
                ? ['link']
                : ['image'],
      });
    }
  });
}

/** Normalized click payload for the broker. */
export interface ContextMenuAction {
  id: ContextMenuId;
  linkUrl?: string;
  srcUrl?: string;
  selectionText?: string;
  pageUrl?: string;
  pageTitle?: string;
}

export function toContextMenuAction(
  info: {
    menuItemId: unknown;
    pageUrl?: string;
    linkUrl?: string;
    srcUrl?: string;
    selectionText?: string;
  },
  tab?: { title?: string } | null,
): ContextMenuAction | null {
  const id = info.menuItemId;
  if (typeof id !== 'string' || !(id in MENU_IDS)) {
    return null;
  }
  return {
    id: id as ContextMenuId,
    pageUrl: info.pageUrl,
    linkUrl: info.linkUrl,
    srcUrl: info.srcUrl,
    selectionText: info.selectionText,
    pageTitle: tab?.title,
  };
}
