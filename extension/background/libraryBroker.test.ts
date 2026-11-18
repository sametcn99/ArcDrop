import { beforeEach, describe, expect, it } from 'bun:test';
import { createLibraryBroker } from './libraryBroker';
import { readVault, writeVault, type StorageLike } from '../shared/vault';
import type { BadgeManager } from '../shared/badge';

interface RouteHandler {
  (init?: RequestInit, url?: string): Response | Promise<Response>;
}

function fakeStorage(): StorageLike {
  let data: Record<string, unknown> = {};
  return {
    get: async () => ({ ...data }),
    set: async (items) => {
      data = { ...data, ...items };
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    },
  };
}

const BOOKMARK = {
  id: 'b1',
  storageKind: 'url',
  url: 'https://example.com/article',
  title: 'An Article',
  excerpt: null,
  note: null,
  favorite: false,
  contentType: 'article',
  coverRef: null,
  iconRef: null,
  tags: [{ id: 't1', name: 'news' }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
  cacheStatus: 'pending',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function broker(
  routes: Record<string, RouteHandler>,
  overrides: {
    tabs?: unknown;
    scripting?: unknown;
    badge?: BadgeManager;
  } = {},
) {
  const area = fakeStorage();
  const badgeCalls: string[] = [];
  const badge: BadgeManager =
    overrides.badge ??
    ({
      show: (state: string) => badgeCalls.push(state),
      clear: () => badgeCalls.push('cleared'),
    } as unknown as BadgeManager);
  const instance = createLibraryBroker({
    area,
    getAccessToken: async () => 'token',
    badge,
    tabs: (overrides.tabs ?? {
      query: async () => [{ id: 1, url: 'https://example.com/article', title: 'An Article' }],
    }) as never,
    scripting: (overrides.scripting ?? {
      executeScript: async () => [
        { result: { ogTitle: 'T', ogDescription: 'D', ogImage: null, images: [] } },
      ],
    }) as never,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      for (const [suffix, handler] of Object.entries(routes)) {
        if (url.includes(suffix)) {
          return await handler(init, url);
        }
      }
      throw new TypeError(`Unexpected URL: ${url}`);
    }) as typeof fetch,
  });
  return { area, badgeCalls, ...instance };
}

beforeEach(async () => {
  // Each broker() call creates a fresh storage; tests that need a connected
  // vault write the baseUrl explicitly.
});

describe('libraryBroker', () => {
  it('fails cleanly when not connected', async () => {
    const instance = broker({});
    const result = await instance.handleMessage({ type: 'library/tags' });
    expect(result).toMatchObject({ ok: false, code: 'SESSION_EXPIRED' });
  });

  it('finds a bookmark by URL with an exact-match filter', async () => {
    const instance = broker({
      '/bookmarks?': () =>
        jsonResponse(200, {
          items: [{ ...BOOKMARK, id: 'b0', url: 'https://example.com/other' }, BOOKMARK],
        }),
    });
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });
    const result = await instance.handleMessage({
      type: 'library/find-by-url',
      url: 'https://example.com/article',
    });
    expect(result).toMatchObject({ ok: true, kind: 'found', bookmark: { id: 'b1' } });
  });

  it('creates a bookmark with the collection query, tags, and updates last-used', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const record = (init?: RequestInit, url?: string): void => {
      calls.push({ url: url ?? '', body: JSON.parse(String(init?.body)) });
    };
    const instance = broker({
      '/b1/tags': (init, url) => {
        record(init, url);
        return jsonResponse(200, []);
      },
      '/bookmarks?collection': (init, url) => {
        record(init, url);
        return jsonResponse(201, BOOKMARK);
      },
    });
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });

    const result = await instance.handleMessage({
      type: 'library/save',
      existingId: null,
      collectionTouched: true,
      draft: {
        url: 'https://example.com/article',
        title: ' An Article ',
        excerpt: 'Summary',
        favorite: true,
        collectionId: 'c1',
        tags: ['news', ' news ', 'tech'],
      },
    });

    expect(result).toMatchObject({ ok: true, kind: 'saved', bookmark: { id: 'b1' } });
    expect(calls[0]?.url).toBe('http://localhost:3000/api/v1/bookmarks?collection=c1');
    expect(calls[0]?.body).toEqual({
      url: 'https://example.com/article',
      title: 'An Article',
      excerpt: 'Summary',
      favorite: true,
    });
    expect(calls[1]?.body).toEqual({ tags: ['news', 'tech'] });

    const vault = await readVault(instance.area);
    expect(vault.settings.lastUsedCollectionId).toBe('c1');
    expect(instance.badgeCalls).toContain('saved');
  });

  it('updates an existing bookmark and replaces collections only when touched', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const record = (init?: RequestInit, url?: string): void => {
      calls.push({ url: url ?? '', body: JSON.parse(String(init?.body)) });
    };
    const instance = broker({
      '/b1/tags': (init, url) => {
        record(init, url);
        return jsonResponse(200, BOOKMARK);
      },
      '/b1/collections': (init, url) => {
        record(init, url);
        return jsonResponse(200, { collections: [] });
      },
      '/bookmarks/b1': (init, url) => {
        record(init, url);
        return jsonResponse(200, BOOKMARK);
      },
    });
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });

    const untouched = await instance.handleMessage({
      type: 'library/save',
      existingId: 'b1',
      collectionTouched: false,
      draft: {
        url: 'https://example.com/article',
        title: 'Updated',
        excerpt: '',
        favorite: false,
        collectionId: null,
        tags: [],
      },
    });
    expect(untouched).toMatchObject({ ok: true, kind: 'saved' });
    expect(calls.map((call) => call.url)).toEqual([
      'http://localhost:3000/api/v1/bookmarks/b1',
      'http://localhost:3000/api/v1/bookmarks/b1/tags',
    ]);
    expect(calls[0]?.body).toEqual({ title: 'Updated', excerpt: null, favorite: false });

    const replaced = await instance.handleMessage({
      type: 'library/save',
      existingId: 'b1',
      collectionTouched: true,
      draft: {
        url: 'https://example.com/article',
        title: 'Updated',
        excerpt: '',
        favorite: false,
        collectionId: 'c2',
        tags: [],
      },
    });
    expect(replaced).toMatchObject({ ok: true, kind: 'saved' });
    const collectionsCall = calls.find((call) => call.url.includes('/b1/collections'));
    expect(collectionsCall?.body).toEqual({ collectionIds: ['c2'] });
  });

  it('trashes a bookmark', async () => {
    let deleted = false;
    const instance = broker({
      '/bookmarks/b1': (_init, url) => {
        if ((url ?? '').endsWith('/bookmarks/b1')) {
          deleted = true;
          return new Response(null, { status: 204 });
        }
        throw new TypeError(`unexpected ${url}`);
      },
    });
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });
    const result = await instance.handleMessage({ type: 'library/trash', id: 'b1' });
    expect(result).toEqual({ ok: true, kind: 'trashed' });
    expect(deleted).toBe(true);
  });

  it('creates a collection from the dialog', async () => {
    const instance = broker({
      '/collections': (init) => {
        expect(String(init?.body)).toBe('{"title":"Reading"}');
        return jsonResponse(201, { id: 'c-new', title: 'Reading' });
      },
    });
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });
    const result = await instance.handleMessage({
      type: 'library/create-collection',
      title: ' Reading ',
      parentId: null,
    });
    expect(result).toMatchObject({
      ok: true,
      kind: 'collection-created',
      collection: { id: 'c-new' },
    });
  });

  it('returns tag usage', async () => {
    const instance = broker({
      '/bookmarks/tags': () => jsonResponse(200, [{ id: 't1', name: 'news', count: 3 }]),
    });
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });
    const result = await instance.handleMessage({ type: 'library/tags' });
    expect(result).toMatchObject({ ok: true, kind: 'tags', usage: [{ name: 'news' }] });
  });

  it('collects page meta via executeScript and tolerates failures', async () => {
    const okInstance = broker({});
    await writeVault(okInstance.area, { baseUrl: 'http://localhost:3000' });
    const ok = await okInstance.handleMessage({ type: 'library/page-meta', tabId: 1 });
    expect(ok).toMatchObject({ ok: true, kind: 'page-meta', meta: { ogTitle: 'T' } });

    const failingInstance = broker(
      {},
      {
        scripting: {
          executeScript: async () => {
            throw new Error('cannot access');
          },
        },
      },
    );
    await writeVault(failingInstance.area, { baseUrl: 'http://localhost:3000' });
    const failed = await failingInstance.handleMessage({ type: 'library/page-meta', tabId: 1 });
    expect(failed).toMatchObject({ ok: true, kind: 'page-meta', meta: null });
  });

  it('quick-saves the active tab and drives the badge', async () => {
    const instance = broker({
      '/bookmarks?search=': () => jsonResponse(200, { items: [] }),
      '/bookmarks?collection': () => jsonResponse(201, BOOKMARK),
    });
    await writeVault(instance.area, {
      baseUrl: 'http://localhost:3000',
      settings: { quickSaveTarget: 'last-used', lastUsedCollectionId: 'c9' },
    });
    const result = await instance.handleMessage({ type: 'library/quick-save' });
    expect(result).toMatchObject({ ok: true, kind: 'quick-saved', result: { status: 'saved' } });
    expect(instance.badgeCalls[0]).toBe('saving');
    expect(instance.badgeCalls).toContain('saved');

    const vault = await readVault(instance.area);
    expect(vault.settings.lastUsedCollectionId).toBe('c9');
  });

  it('reports already-saved when the URL exists', async () => {
    const instance = broker({
      '/bookmarks?search=': () => jsonResponse(200, { items: [BOOKMARK] }),
    });
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });
    const result = await instance.handleMessage({ type: 'library/quick-save' });
    expect(result).toMatchObject({
      ok: true,
      kind: 'quick-saved',
      result: { status: 'already-saved' },
    });
  });
});
