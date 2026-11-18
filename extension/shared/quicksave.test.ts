import { describe, expect, it } from 'bun:test';
import { quickSave, type QuickSaveDeps } from './quicksave';
import { DEFAULT_VAULT_SETTINGS, type VaultSettings } from './vault';

const TAB = {
  tabId: 1,
  url: 'https://example.com/article',
  title: 'An Article',
  favIconUrl: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  url: string;
  init?: RequestInit;
}

function fetchWith(routes: Array<{ match: (url: string) => boolean; respond: () => Response }>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const route = routes.find((candidate) => candidate.match(url));
    if (!route) throw new TypeError(`Unexpected URL: ${url}`);
    return route.respond();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function deps(
  overrides: Omit<Partial<QuickSaveDeps>, 'settings'> & { settings?: Partial<VaultSettings> } = {},
) {
  const { settings: settingsPatch, ...rest } = overrides;
  const savedTo: string[] = [];
  const settings: VaultSettings = {
    ...DEFAULT_VAULT_SETTINGS,
    ...settingsPatch,
  };
  const base = {
    baseUrl: 'http://localhost:3000',
    accessToken: 'token',
    settings,
    tab: TAB,
    onSavedToCollection: async (collectionId: string) => {
      savedTo.push(collectionId);
    },
  };
  return { ...base, ...rest, savedTo } as QuickSaveDeps & { savedTo: string[] };
}

describe('quickSave', () => {
  it('creates when new, targeting unsorted, and reports saved', async () => {
    const { calls, fetchImpl } = fetchWith([
      {
        match: (url) => url.includes('/bookmarks?search='),
        respond: () => jsonResponse(200, { items: [] }),
      },
      {
        match: (url) => url.includes('/bookmarks'),
        respond: () => jsonResponse(201, { id: 'b1', url: TAB.url }),
      },
    ]);
    const result = await quickSave(deps({ fetchImpl, settings: { quickSaveTarget: 'unsorted' } }));
    expect(result.status).toBe('saved');
    const call = calls[1];
    if (call === undefined) {
      throw new Error('expected a create call');
    }
    expect(call.url).toBe('http://localhost:3000/api/v1/bookmarks');
    const body = JSON.parse(String(call.init?.body));
    expect(body).toEqual({ url: TAB.url, title: TAB.title, favorite: false });
  });

  it('passes the last-used collection via the quick-add query', async () => {
    const { calls, fetchImpl } = fetchWith([
      {
        match: (url) => url.includes('/bookmarks?search='),
        respond: () => jsonResponse(200, { items: [] }),
      },
      {
        match: (url) => url.includes('/bookmarks'),
        respond: () => jsonResponse(201, { id: 'b1' }),
      },
    ]);
    await quickSave(
      deps({
        fetchImpl,
        settings: { quickSaveTarget: 'last-used', lastUsedCollectionId: 'c9' },
      }),
    );
    const createCall = calls[1];
    expect(createCall?.url).toBe('http://localhost:3000/api/v1/bookmarks?collection=c9');
  });

  it('returns already-saved when the URL exists and skips creation', async () => {
    const { calls, fetchImpl } = fetchWith([
      {
        match: (url) => url.includes('/bookmarks?search='),
        respond: () =>
          jsonResponse(200, {
            items: [
              { id: 'b0', url: TAB.url },
              { id: 'x', url: 'https://other' },
            ],
          }),
      },
    ]);
    const result = await quickSave(deps({ fetchImpl }));
    expect(result.status).toBe('already-saved');
    if (result.status === 'already-saved') {
      expect(result.bookmark.id).toBe('b0');
    }
    expect(calls).toHaveLength(1);
  });

  it('notifies onSavedToCollection when a collection was used', async () => {
    const env = fetchWith([
      {
        match: (url) => url.includes('/bookmarks?search='),
        respond: () => jsonResponse(200, { items: [] }),
      },
      {
        match: (url) => url.includes('/bookmarks'),
        respond: () => jsonResponse(201, { id: 'b1' }),
      },
    ]);
    const withCollection = deps({
      fetchImpl: env.fetchImpl,
      settings: { quickSaveTarget: 'last-used', lastUsedCollectionId: 'c5' },
    });
    await quickSave(withCollection);
    expect(withCollection.savedTo).toEqual(['c5']);
  });
});
