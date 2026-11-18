// Active-tab context for the popup editor. With only the `activeTab`
// permission (declared in E0), url/title/favIconUrl become readable once the
// user invokes the extension (opening the popup or pressing the shortcut) —
// no blanket "tabs" permission needed.

export interface TabContext {
  tabId: number;
  url: string;
  title: string;
  favIconUrl: string | null;
}

export interface TabQueryResult {
  id?: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
}

export interface TabsLike {
  query(info: Record<string, unknown>): Promise<TabQueryResult[]>;
}

export function chromeTabs(): TabsLike {
  return chrome.tabs;
}

/** True for URLs the extension is allowed to save. */
export function isSavableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The active tab of the current window, when it is a savable http(s) page.
 * Returns null for chrome:// pages, the extension's own pages, etc.
 */
export async function getActiveTabContext(
  tabs: TabsLike = chromeTabs(),
): Promise<TabContext | null> {
  const results = await tabs.query({ active: true, currentWindow: true });
  const tab = results[0];
  if (!tab || typeof tab.id !== 'number' || !tab.url || !isSavableUrl(tab.url)) {
    return null;
  }
  return {
    tabId: tab.id,
    url: tab.url,
    title: tab.title ?? tab.url,
    favIconUrl: tab.favIconUrl ?? null,
  };
}
