import { describe, expect, it } from 'bun:test';
import { getActiveTabContext, isSavableUrl, type TabsLike } from './tabContext';

function tabsWith(entries: Array<{ id?: number; url?: string; title?: string }>): TabsLike {
  return {
    query: async () => entries,
  };
}

describe('isSavableUrl', () => {
  it('accepts http(s) pages', () => {
    expect(isSavableUrl('https://example.com/a')).toBe(true);
    expect(isSavableUrl('http://localhost:3000/x?y=1')).toBe(true);
  });
  it('rejects internal pages and junk', () => {
    expect(isSavableUrl('chrome://extensions')).toBe(false);
    expect(isSavableUrl('chrome-extension://abc/popup/index.html')).toBe(false);
    expect(isSavableUrl('about:blank')).toBe(false);
    expect(isSavableUrl('not a url')).toBe(false);
  });
});

describe('getActiveTabContext', () => {
  it('returns the active tab with id, url and title', async () => {
    const context = await getActiveTabContext(
      tabsWith([{ id: 5, url: 'https://e.com', title: 'Example' }]),
    );
    expect(context).toEqual({ tabId: 5, url: 'https://e.com', title: 'Example', favIconUrl: null });
  });

  it('returns null for unsavable or id-less tabs', async () => {
    expect(
      await getActiveTabContext(tabsWith([{ url: 'chrome://newtab', title: 'n' }])),
    ).toBeNull();
    expect(await getActiveTabContext(tabsWith([{ url: 'https://e.com' }]))).toBeNull();
    expect(await getActiveTabContext(tabsWith([]))).toBeNull();
  });
});
