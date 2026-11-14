import { http, HttpResponse } from 'msw';
import type { AuthSession, Session, User } from '../../api/schemas/auth';
import type { Bookmark, BookmarkStats, TagUsage } from '../../api/schemas/bookmarks';
import type { Collection, CollectionNode } from '../../api/schemas/collections';
import type { ProblemDetails } from '../../api/schemas/problem';

export function makeMockUser(overrides: Partial<User> = {}): User {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@arcdrop.test',
    role: 'user',
    status: 'active',
    hasPassword: true,
    totpEnabled: false,
    createdAt: '2026-11-14T00:00:00.000Z',
    ...overrides,
  };
}

export function makeMockSession(
  overrides: {
    user?: Partial<User>;
    accessToken?: string;
    refreshToken?: string;
  } = {},
): AuthSession {
  return {
    user: makeMockUser(overrides.user),
    accessToken: overrides.accessToken ?? 'access-token-initial',
    refreshToken: overrides.refreshToken ?? 'refresh-token-initial',
  };
}

export function makeMockSessionList(): Session[] {
  return [
    {
      id: '22222222-2222-4222-8222-222222222222',
      deviceLabel: 'Chrome — Desktop',
      createdAt: '2026-11-14T00:00:00.000Z',
      lastUsedAt: '2026-11-14T01:00:00.000Z',
      current: true,
      revokedAt: null,
    },
  ];
}

export function makeMockBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  const id = overrides.id ?? 'bm-1';
  const url =
    overrides.storageKind === 'file' ? null : (overrides.url ?? 'https://arcdrop.test/docs/guide');
  return {
    id,
    storageKind: 'url',
    url,
    title: 'ArcDrop Architecture Guide',
    excerpt: 'Self-hosted bookmarking platform with real-time sync and offline support.',
    note: null,
    favorite: false,
    contentType: 'article',
    coverRef: null,
    iconRef: null,
    urlParts:
      url !== null
        ? {
            scheme: 'https',
            host: 'arcdrop.test',
            domain: 'arcdrop.test',
            port: null,
            path: '/docs/guide',
            query: null,
            fragment: null,
          }
        : null,
    fileRef: null,
    fileName: null,
    fileMime: null,
    fileSize: null,
    tags: [
      { id: 'tag-1', name: 'architecture' },
      { id: 'tag-2', name: 'sync' },
    ],
    lastCheckedAt: null,
    brokenReason: null,
    brokenAt: null,
    reminderAt: null,
    remindedAt: null,
    cacheStatus: 'ready',
    cacheCheckedAt: '2026-11-14T00:05:00.000Z',
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:10:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

export function makeMockCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'col-1',
    parentId: null,
    title: 'Reading List',
    icon: null,
    color: null,
    order: 0,
    bookmarkCount: 2,
    share: {
      enabled: false,
      shareToken: null,
    },
    createdAt: '2026-11-14T00:00:00.000Z',
    updatedAt: '2026-11-14T00:00:00.000Z',
    ...overrides,
  };
}

export function makeMockTagUsage(overrides: Partial<TagUsage> = {}): TagUsage {
  return {
    id: 'tag-1',
    name: 'architecture',
    count: 2,
    ...overrides,
  };
}

export function makeDefaultBookmarkFixtures(): Bookmark[] {
  return [
    makeMockBookmark({
      id: 'bm-1',
      title: 'ArcDrop Architecture Guide',
      url: 'https://arcdrop.test/docs/architecture',
      excerpt: 'Overview of the offline-first sync protocol and stores.',
      favorite: true,
      contentType: 'article',
      tags: [
        { id: 'tag-1', name: 'architecture' },
        { id: 'tag-2', name: 'sync' },
      ],
      updatedAt: '2026-11-14T02:00:00.000Z',
    }),
    makeMockBookmark({
      id: 'bm-2',
      title: 'MUI Design Tokens Reference',
      url: 'https://mui.com/material-ui/customization/palette/',
      excerpt: 'CSS variables and semantic color tokens for multi-theme apps.',
      favorite: false,
      contentType: 'link',
      tags: [{ id: 'tag-3', name: 'design' }],
      updatedAt: '2026-11-14T01:00:00.000Z',
    }),
  ];
}

export function makeMockStats(overrides: Partial<BookmarkStats> = {}): BookmarkStats {
  return {
    total: 2,
    unassigned: 1,
    trashed: 0,
    favorites: 1,
    ...overrides,
  };
}

export function problemJsonResponse(
  status: number,
  problem: Partial<ProblemDetails> & { code: string; detail: string },
) {
  const payload: ProblemDetails = {
    type: `https://arcdrop.dev/problems/${problem.code.toLowerCase().replaceAll('_', '-')}`,
    title: problem.title ?? problem.code,
    status,
    requestId: problem.requestId ?? 'req-test-0001',
    ...problem,
  };
  return HttpResponse.json(payload, {
    status,
    headers: {
      'Content-Type': 'application/problem+json; charset=utf-8',
      'x-request-id': payload.requestId ?? 'req-test-0001',
    },
  });
}

function buildDefaultTree(items: Collection[]): CollectionNode[] {
  const byId = new Map<string, CollectionNode>();
  for (const col of items) {
    byId.set(col.id, { ...col, children: [] });
  }
  const roots: CollectionNode[] = [];
  for (const col of items) {
    const node = byId.get(col.id);
    if (!node) continue;
    const parent = col.parentId ? byId.get(col.parentId) : undefined;
    if (parent && parent.id !== node.id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export const authHandlers = [
  http.post('*/api/v1/auth/bootstrap', async ({ request }) => {
    const body = (await request.json()) as { email: string };
    return HttpResponse.json(
      makeMockSession({
        user: { email: body.email.trim().toLowerCase(), role: 'admin' },
        accessToken: 'access-token-bootstrap',
        refreshToken: 'refresh-token-bootstrap',
      }),
      { status: 201 },
    );
  }),

  http.post('*/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    return HttpResponse.json(
      makeMockSession({
        user: { email: body.email.trim().toLowerCase() },
        accessToken: 'access-token-login',
        refreshToken: 'refresh-token-login',
      }),
      { status: 201 },
    );
  }),

  http.post('*/api/v1/auth/login/tfa', async () => {
    return HttpResponse.json(
      makeMockSession({
        user: { totpEnabled: true },
        accessToken: 'access-token-tfa',
        refreshToken: 'refresh-token-tfa',
      }),
      { status: 201 },
    );
  }),

  http.post('*/api/v1/auth/refresh', async () => {
    return HttpResponse.json(
      makeMockSession({
        accessToken: 'access-token-rotated',
        refreshToken: 'refresh-token-rotated',
      }),
      { status: 201 },
    );
  }),

  http.post('*/api/v1/auth/logout', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('*/api/v1/auth/claim', async () => {
    return HttpResponse.json(
      makeMockSession({
        accessToken: 'access-token-claimed',
        refreshToken: 'refresh-token-claimed',
      }),
      { status: 201 },
    );
  }),

  http.post('*/api/v1/auth/register', async ({ request }) => {
    const body = (await request.json()) as { email: string };
    return HttpResponse.json(
      makeMockSession({
        user: { email: body.email.trim().toLowerCase(), role: 'user' },
        accessToken: 'access-token-register',
        refreshToken: 'refresh-token-register',
      }),
      { status: 201 },
    );
  }),

  http.get('*/api/v1/auth/me', ({ request }) => {
    const auth = request.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return problemJsonResponse(401, {
        code: 'UNAUTHORIZED',
        title: 'Unauthorized',
        detail: 'Missing bearer token',
      });
    }
    return HttpResponse.json(makeMockUser(), { status: 200 });
  }),

  http.post('*/api/v1/auth/password', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('*/api/v1/auth/sessions', () => {
    return HttpResponse.json(makeMockSessionList(), { status: 200 });
  }),

  http.delete('*/api/v1/auth/sessions/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('*/api/v1/auth/tfa/setup', () => {
    return HttpResponse.json(
      {
        secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
        otpauthUri:
          'otpauth://totp/ArcDrop:user%40arcdrop.test?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=ArcDrop',
      },
      { status: 200 },
    );
  }),

  http.post('*/api/v1/auth/tfa/enable', () => {
    return HttpResponse.json(
      {
        recoveryCodes: ['a1b2c-d3e4f', '11111-22222'],
      },
      { status: 200 },
    );
  }),

  http.post('*/api/v1/auth/tfa/disable', () => {
    return new HttpResponse(null, { status: 204 });
  }),
];

export const libraryHandlers = [
  http.get('*/api/v1/bookmarks/stats', () => {
    return HttpResponse.json(makeMockStats(), { status: 200 });
  }),

  http.get('*/api/v1/bookmarks/tags', () => {
    return HttpResponse.json(
      [
        makeMockTagUsage({ id: 'tag-1', name: 'architecture', count: 1 }),
        makeMockTagUsage({ id: 'tag-2', name: 'sync', count: 1 }),
        makeMockTagUsage({ id: 'tag-3', name: 'design', count: 1 }),
      ],
      { status: 200 },
    );
  }),

  http.post('*/api/v1/bookmarks/bulk', async ({ request }) => {
    const body = (await request.json()) as {
      action: 'move' | 'addTags' | 'removeTags' | 'trash' | 'restore' | 'delete';
      ids: string[];
    };
    return HttpResponse.json(
      {
        action: body.action,
        affected: body.ids.length,
        ids: body.ids,
      },
      { status: 200 },
    );
  }),

  http.get('*/api/v1/bookmarks', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '24');
    const favorite = url.searchParams.get('favorite');
    const unassignedOnly = url.searchParams.get('unassignedOnly');

    let items = makeDefaultBookmarkFixtures();
    if (favorite === 'true') {
      items = items.filter((item) => item.favorite);
    }
    if (unassignedOnly === 'true') {
      items = items.filter((item) => item.id === 'bm-2');
    }

    return HttpResponse.json(
      {
        items,
        totalCount: items.length,
        page,
        pageSize,
      },
      { status: 200 },
    );
  }),

  http.get('*/api/v1/bookmarks/:id', ({ params }) => {
    const id = String(params.id);
    const match = makeDefaultBookmarkFixtures().find((item) => item.id === id);
    return HttpResponse.json(match ?? makeMockBookmark({ id }), { status: 200 });
  }),

  http.put('*/api/v1/bookmarks/:id', async ({ params, request }) => {
    const id = String(params.id);
    const body = (await request.json()) as Partial<Bookmark>;
    const existing =
      makeDefaultBookmarkFixtures().find((item) => item.id === id) ?? makeMockBookmark({ id });
    return HttpResponse.json(
      {
        ...existing,
        ...body,
        updatedAt: '2026-11-14T03:00:00.000Z',
      },
      { status: 200 },
    );
  }),

  http.put('*/api/v1/bookmarks/:id/collections', async ({ request }) => {
    const body = (await request.json()) as { collectionIds: string[] };
    const collections = body.collectionIds.map((id) => ({
      id,
      title: id === 'col-1' ? 'Reading List' : `Collection ${id}`,
    }));
    return HttpResponse.json({ collections }, { status: 200 });
  }),

  http.delete('*/api/v1/bookmarks/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('*/api/v1/bookmarks/:id/restore', ({ params }) => {
    const id = String(params.id);
    return HttpResponse.json(
      makeMockBookmark({
        id,
        deletedAt: null,
        updatedAt: '2026-11-14T03:05:00.000Z',
      }),
      { status: 200 },
    );
  }),

  http.get('*/api/v1/collections', ({ request }) => {
    const url = new URL(request.url);
    const shared = url.searchParams.get('shared');
    let items = [makeMockCollection()];
    if (shared === 'true') {
      items = items.filter((item) => item.share.enabled);
    } else if (shared === 'false') {
      items = items.filter((item) => !item.share.enabled);
    }
    return HttpResponse.json({ items }, { status: 200 });
  }),

  http.get('*/api/v1/collections/tree', () => {
    return HttpResponse.json(buildDefaultTree([makeMockCollection()]), { status: 200 });
  }),

  http.post('*/api/v1/collections', async ({ request }) => {
    const body = (await request.json()) as {
      title: string;
      icon?: string;
      color?: string;
      parentId?: string | null;
    };
    return HttpResponse.json(
      makeMockCollection({
        id: 'col-created',
        title: body.title,
        icon: body.icon ?? null,
        color: body.color ?? null,
        parentId: body.parentId ?? null,
        bookmarkCount: 0,
      }),
      { status: 201 },
    );
  }),

  http.patch('*/api/v1/collections/order', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('*/api/v1/collections/merge', async ({ request }) => {
    const body = (await request.json()) as { sourceIds: string[]; targetId: string };
    return HttpResponse.json(
      {
        target: makeMockCollection({ id: body.targetId }),
        trashedIds: body.sourceIds,
        movedChildren: 0,
        movedBookmarks: 1,
      },
      { status: 200 },
    );
  }),

  http.post('*/api/v1/collections/sort-alphabetical', () => {
    return HttpResponse.json({ updated: 0 }, { status: 200 });
  }),

  http.post('*/api/v1/collections/delete-empty', () => {
    return HttpResponse.json({ trashed: 0, kept: 1 }, { status: 200 });
  }),

  http.get('*/api/v1/collections/:id', ({ params }) => {
    const id = String(params.id);
    return HttpResponse.json(makeMockCollection({ id }), { status: 200 });
  }),

  http.put('*/api/v1/collections/:id', async ({ params, request }) => {
    const id = String(params.id);
    const body = (await request.json()) as Partial<Collection>;
    return HttpResponse.json(
      makeMockCollection({
        id,
        ...body,
        updatedAt: '2026-11-14T03:10:00.000Z',
      }),
      { status: 200 },
    );
  }),

  http.put('*/api/v1/collections/:id/share', async ({ params, request }) => {
    const id = String(params.id);
    const body = (await request.json()) as { enabled: boolean };
    const shareToken = body.enabled ? `share-token-${id}` : null;
    return HttpResponse.json(
      {
        collectionId: id,
        enabled: body.enabled,
        shareToken,
        publicPath: shareToken ? `/api/v1/public/collections/${shareToken}` : null,
        rssPath: shareToken ? `/api/v1/public/collections/${shareToken}/rss` : null,
      },
      { status: 200 },
    );
  }),

  http.patch('*/api/v1/collections/:id/bookmarks/order', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete('*/api/v1/collections/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.post('*/api/v1/collections/:id/restore', ({ params }) => {
    const id = String(params.id);
    return HttpResponse.json(makeMockCollection({ id }), { status: 200 });
  }),
];

export const syncHandlers = [
  http.get('*/api/v1/sync/state', () => {
    return HttpResponse.json({ seq: '10' }, { status: 200 });
  }),

  http.get('*/api/v1/sync/changes', ({ request }) => {
    const url = new URL(request.url);
    const since = url.searchParams.get('since') ?? '10';
    return HttpResponse.json(
      {
        resyncRequired: false,
        changes: [],
        cursor: since,
      },
      { status: 200 },
    );
  }),

  http.post('*/api/v1/sync/ticket', () => {
    return HttpResponse.json(
      {
        ticket: 'sync-ticket-default',
        expiresAt: '2026-11-14T16:00:00.000Z',
      },
      { status: 201 },
    );
  }),
];

export const defaultHandlers = [...authHandlers, ...libraryHandlers, ...syncHandlers];
