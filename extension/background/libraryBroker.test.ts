import { beforeEach, describe, expect, it } from 'bun:test';
import { createLibraryBroker, type SessionAreaLike } from './libraryBroker';
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
    badge?: BadgeManager;
    tabs?: unknown;
    scripting?: unknown;
    permissionsGranted?: boolean;
    sessionArea?: SessionAreaLike;
    /** Response served for non-API fetches (the context-menu image flow). */
    imageResponse?: { bytes: string; mime: string; status?: number };
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
  const permissions = {
    request: async () => overrides.permissionsGranted ?? true,
    contains: async () => overrides.permissionsGranted ?? true,
  };
  const instance = createLibraryBroker({
    area,
    getAccessToken: async () => 'token',
    badge,
    permissions,
    sessionArea:
      overrides.sessionArea ??
      ({
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      } as SessionAreaLike),
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
      if (!url.includes('localhost:3000')) {
        // The context-menu image flow fetching from the source origin.
        const image = overrides.imageResponse;
        if (!image) throw new TypeError(`Unexpected external URL: ${url}`);
        return new Response(new Blob([image.bytes], { type: image.mime }), {
          status: image.status ?? 200,
          headers: { 'content-type': image.mime },
        });
      }
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

  // ---- E4: context menus + save all tabs --------------------------------

  it('saves a link, skipping URLs already present', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const instance = broker({
      '/bookmarks?search=': () => jsonResponse(200, { items: [BOOKMARK] }),
      '/bookmarks': (init, url) => {
        calls.push({ url: url ?? '', body: JSON.parse(String(init?.body)) });
        return jsonResponse(201, BOOKMARK);
      },
    });
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });

    const duplicate = await instance.handleMessage({
      type: 'library/save-link',
      linkUrl: 'https://example.com/article',
    });
    expect(duplicate).toEqual({ ok: true, kind: 'done' });
    expect(calls).toHaveLength(0);

    const fresh = await instance.handleMessage({
      type: 'library/save-link',
      linkUrl: 'https://other.example/page',
    });
    expect(fresh).toEqual({ ok: true, kind: 'done' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      url: 'https://other.example/page',
      title: 'other.example — page',
      favorite: false,
    });
  });

  it('saves a selection: appends for saved pages, creates otherwise', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    // Stateful fixture: after the first append the saved page carries the
    // selection in its excerpt.
    let storedExcerpt: string | null = null;
    const withExisting = broker({
      '/bookmarks?search=': () =>
        jsonResponse(200, { items: [{ ...BOOKMARK, excerpt: storedExcerpt }] }),
      '/bookmarks/b1': (init, url) => {
        calls.push({ url: url ?? '', body: JSON.parse(String(init?.body)) });
        const body = JSON.parse(String(init?.body)) as { excerpt?: string };
        if (typeof body['excerpt'] === 'string') storedExcerpt = body['excerpt'];
        return jsonResponse(200, BOOKMARK);
      },
    });
    await writeVault(withExisting.area, { baseUrl: 'http://localhost:3000' });

    const appended = await withExisting.handleMessage({
      type: 'library/save-selection',
      selectionText: ' A quote ',
      pageUrl: 'https://example.com/article',
      pageTitle: 'An Article',
    });
    expect(appended).toEqual({ ok: true, kind: 'done' });
    expect(calls[0]?.body).toEqual({ excerpt: 'A quote' });

    // Idempotent: an unchanged excerpt triggers no PUT.
    await withExisting.handleMessage({
      type: 'library/save-selection',
      selectionText: 'A quote',
      pageUrl: 'https://example.com/article',
    });
    expect(calls).toHaveLength(1);

    const fresh = broker({
      '/bookmarks?search=': () => jsonResponse(200, { items: [] }),
      '/bookmarks': (init, url) => {
        calls.push({ url: url ?? '', body: JSON.parse(String(init?.body)) });
        return jsonResponse(201, BOOKMARK);
      },
    });
    await writeVault(fresh.area, { baseUrl: 'http://localhost:3000' });
    await fresh.handleMessage({
      type: 'library/save-selection',
      selectionText: 'A quote',
      pageUrl: 'https://example.com/other',
      pageTitle: 'Other',
    });
    expect(calls.at(-1)?.body).toEqual({
      url: 'https://example.com/other',
      title: 'Other',
      excerpt: 'A quote',
      favorite: false,
    });
  });

  it('stashes a pending permission when the image origin is not granted', async () => {
    const sessionData: Record<string, unknown> = {};
    const instance = broker(
      {},
      {
        permissionsGranted: false,
        sessionArea: {
          get: async () => ({ ...sessionData }),
          set: async (items) => {
            Object.assign(sessionData, items);
          },
          remove: async (keys) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionData[key];
          },
        },
      },
    );
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });

    const result = await instance.handleMessage({
      type: 'library/save-image',
      srcUrl: 'https://images.example/pic.png',
      pageTitle: 'Page',
    });
    expect(result).toMatchObject({ ok: false, code: 'HOST_PERMISSION_REQUIRED' });
    expect(sessionData['pendingImageSave']).toMatchObject({
      origin: 'https://images.example',
      srcUrl: 'https://images.example/pic.png',
    });

    const pending = await instance.handleMessage({ type: 'library/pending-permission' });
    expect(pending).toMatchObject({
      ok: true,
      kind: 'pending-permission',
      pending: { origin: 'https://images.example' },
    });
  });

  it('completes the pending image save after the popup grants access', async () => {
    const uploads: Array<{ url: string; body: FormData | null }> = [];
    const sessionData: Record<string, unknown> = {};
    const sessionArea: SessionAreaLike = {
      get: async () => ({ ...sessionData }),
      set: async (items) => {
        Object.assign(sessionData, items);
      },
      remove: async (keys) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionData[key];
      },
    };
    const instance = broker(
      {
        '/bookmarks/file': (init, url) => {
          uploads.push({ url: url ?? '', body: (init?.body as FormData) ?? null });
          return jsonResponse(201, BOOKMARK);
        },
      },
      {
        permissionsGranted: true,
        sessionArea,
        imageResponse: { bytes: 'fake-png-bytes', mime: 'image/png' },
      },
    );
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });
    await instance.handleMessage({
      type: 'library/save-image',
      srcUrl: 'https://images.example/pic.png',
      pageTitle: 'Page',
    });
    sessionData['pendingImageSave'] = {
      origin: 'https://images.example',
      srcUrl: 'https://images.example/pic.png',
      savedAt: 0,
    };

    const result = await instance.handleMessage({ type: 'library/complete-pending-image' });
    expect(result).toMatchObject({ ok: true, kind: 'saved', bookmark: { id: 'b1' } });
    expect(uploads).toHaveLength(2);
    expect(uploads[1]?.url).toBe('http://localhost:3000/api/v1/bookmarks/file');
    expect((uploads[1]?.body as FormData).get('file')).not.toBeNull();
    expect(sessionData['pendingImageSave']).toBeUndefined();
  });

  it('rejects SVG images in the image flow', async () => {
    const instance = broker(
      {},
      {
        permissionsGranted: true,
        imageResponse: { bytes: '<svg/>', mime: 'image/svg+xml' },
      },
    );
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });
    const result = await instance.handleMessage({
      type: 'library/save-image',
      srcUrl: 'https://images.example/pic.svg',
    });
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED_IMAGE' });
  });

  it('lists savable tabs deduplicated and http-only', async () => {
    const instance = broker(
      {},
      {
        tabs: {
          query: async () => [
            { url: 'https://a.example/1', title: 'A' },
            { url: 'https://a.example/1', title: 'A dup' },
            { url: 'chrome://newtab', title: 'n' },
            { url: 'https://b.example/2', title: 'B' },
          ],
        },
      },
    );
    const result = await instance.handleMessage({ type: 'library/list-savable-tabs' });
    expect(result).toMatchObject({ ok: true, kind: 'savable-tabs', duplicatesRemoved: 1 });
    if (result.ok && result.kind === 'savable-tabs') {
      expect(result.tabs.map((tab) => tab.url)).toEqual([
        'https://a.example/1',
        'https://b.example/2',
      ]);
    }
  });

  it('save-all-tabs skips already-saved URLs and updates last-used', async () => {
    const created: string[] = [];
    const instance = broker(
      {
        '/bookmarks?search=': (_init, url) =>
          jsonResponse(200, {
            items: (url ?? '').includes(encodeURIComponent('https://b.example/2'))
              ? [{ id: 'b0', url: 'https://b.example/2' }]
              : [],
          }),
        '/bookmarks?collection': (init, url) => {
          void init;
          created.push(url ?? '');
          return jsonResponse(201, BOOKMARK);
        },
      },
      {
        tabs: {
          query: async () => [
            { id: 1, url: 'https://a.example/1', title: 'A' },
            { id: 2, url: 'https://b.example/2', title: 'B' },
          ],
        },
      },
    );
    await writeVault(instance.area, {
      baseUrl: 'http://localhost:3000',
      settings: { quickSaveTarget: 'last-used', lastUsedCollectionId: null },
    });

    const result = await instance.handleMessage({
      type: 'library/save-all-tabs',
      collectionId: 'c7',
    });
    expect(result).toMatchObject({
      ok: true,
      kind: 'save-all-summary',
      summary: { saved: 1, skipped: 1, failed: 0, duplicatesRemoved: 0 },
    });
    expect(created[0]).toContain('collection=c7');
    const vault = await readVault(instance.area);
    expect(vault.settings.lastUsedCollectionId).toBe('c7');
  });

  it('assigns a cover through the server endpoint (E7)', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const instance = broker({
      '/bookmarks/b1/cover': (init, url) => {
        calls.push({ url: url ?? '', body: JSON.parse(String(init?.body)) });
        return jsonResponse(200, BOOKMARK);
      },
    });
    await writeVault(instance.area, { baseUrl: 'http://localhost:3000' });

    const result = await instance.handleMessage({
      type: 'library/set-cover',
      bookmarkId: 'b1',
      imageUrl: 'https://images.example/pick.png',
    });
    expect(result).toMatchObject({ ok: true, kind: 'cover-assigned', bookmark: { id: 'b1' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://localhost:3000/api/v1/bookmarks/b1/cover');
    expect(calls[0]?.body).toEqual({ imageUrl: 'https://images.example/pick.png' });
    expect(instance.badgeCalls).toContain('saved');
  });

  it('honors the badgeEnabled=false setting (no badge calls)', async () => {
    const badgeCalls: string[] = [];
    const instance = broker(
      {
        '/bookmarks?search=': () => jsonResponse(200, { items: [] }),
        '/bookmarks': () => jsonResponse(201, BOOKMARK),
      },
      {
        badge: {
          show: (state: string) => badgeCalls.push(state),
          clear: () => badgeCalls.push('cleared'),
        } as unknown as BadgeManager,
      },
    );
    await writeVault(instance.area, {
      baseUrl: 'http://localhost:3000',
      settings: { quickSaveTarget: 'unsorted', badgeEnabled: false },
    });

    const result = await instance.handleMessage({ type: 'library/quick-save' });
    expect(result).toMatchObject({ ok: true, kind: 'quick-saved' });
    expect(badgeCalls).toHaveLength(0);
  });
});
