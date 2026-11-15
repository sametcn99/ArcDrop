import { http, HttpResponse } from 'msw';
import type { AuthSession, Session, User } from '../../api/schemas/auth';
import type {
  Bookmark,
  BookmarkArchive,
  BookmarkStats,
  Highlight,
  TagUsage,
} from '../../api/schemas/bookmarks';
import type { Collection, CollectionNode } from '../../api/schemas/collections';
import type { DuplicateGroup } from '../../api/schemas/health';
import type { Notification } from '../../api/schemas/notifications';
import type { ImportSummary } from '../../api/schemas/portability';
import type { ProblemDetails } from '../../api/schemas/problem';
import type { Settings } from '../../api/schemas/settings';

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

export function makeMockBookmarkArchive(overrides: Partial<BookmarkArchive> = {}): BookmarkArchive {
  return {
    bookmarkId: overrides.bookmarkId ?? 'bm-1',
    cacheStatus: overrides.cacheStatus ?? 'ready',
    cacheCheckedAt: '2026-11-14T00:05:00.000Z',
    html: '<article><h1>Archived Snapshot</h1><p>Readable archived copy.</p></article>',
    text: 'Archived Snapshot\n\nReadable archived copy.',
    ...overrides,
  };
}

export function makeMockCollection(
  overrides: Partial<Collection> & { children?: unknown[] } = {},
): Collection & { children?: unknown[] } {
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

export function makeMockHighlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: 'hl-1',
    bookmarkId: 'bm-1',
    text: 'Self-hosted bookmarking platform with real-time sync.',
    note: null,
    color: 'amber',
    createdAt: '2026-11-14T00:12:00.000Z',
    updatedAt: '2026-11-14T00:12:00.000Z',
    ...overrides,
  };
}

export function makeMockNotification(overrides: Partial<Notification> = {}): Notification {
  const bookmarkId = overrides.bookmarkId ?? 'bm-1';
  return {
    id: 'notif-1',
    type: 'reminder',
    bookmarkId,
    payload: {
      bookmarkId: bookmarkId ?? 'bm-1',
      title: 'ArcDrop Architecture Guide',
      url: 'https://arcdrop.test/docs/architecture',
      reminderAt: '2026-11-14T12:00:00.000Z',
    },
    createdAt: '2026-11-14T12:00:01.000Z',
    readAt: null,
    ...overrides,
  };
}

export function makeMockSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    registrationOpen: false,
    trashRetentionDays: 30,
    changeLogRetentionDays: 90,
    brokenLinkCheckMode: 'default',
    archiveMaxBytes: 73_400_320,
    fileMaxBytes: 314_572_800,
    monthlyUploadQuotaBytes: 10_737_418_240,
    ...overrides,
  };
}

export function makeMockDuplicateGroup(overrides: Partial<DuplicateGroup> = {}): DuplicateGroup {
  return {
    normalizedUrl: overrides.normalizedUrl ?? 'arcdrop.test/docs/guide',
    original:
      overrides.original ??
      makeMockBookmark({
        id: 'bm-dup-orig',
        title: 'Guide (Original)',
        url: 'https://arcdrop.test/docs/guide',
        tags: [{ id: 'tag-1', name: 'architecture' }],
        createdAt: '2026-11-10T00:00:00.000Z',
      }),
    extras: overrides.extras ?? [
      makeMockBookmark({
        id: 'bm-dup-extra-1',
        title: 'Guide Copy with Tracking',
        url: 'https://www.arcdrop.test/docs/guide/?utm_source=feed',
        tags: [{ id: 'tag-2', name: 'sync' }],
        createdAt: '2026-11-12T00:00:00.000Z',
      }),
    ],
  };
}

export function makeMockImportSummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    created: 3,
    updated: 1,
    skipped: [],
    errors: [],
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

  http.post('*/api/v1/me/reset-data', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.delete('*/api/v1/me', () => {
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

  http.put('*/api/v1/tags/:name', async ({ params, request }) => {
    const body = (await request.json()) as { name: string };
    return HttpResponse.json(
      {
        id: `tag-${String(params.name).toLowerCase()}`,
        name: body.name,
      },
      { status: 200 },
    );
  }),

  http.delete('*/api/v1/tags/:name', () => {
    return new HttpResponse(null, { status: 204 });
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

  http.post('*/api/v1/bookmarks/file', async ({ request }) => {
    const formData = await request.formData();
    const file = formData.get('file');
    const fileName = file instanceof File ? file.name : 'uploaded.bin';
    const fileMime = file instanceof File && file.type ? file.type : 'application/octet-stream';
    const fileSize = file instanceof File ? file.size : 128;
    const rawTitle = formData.get('title');
    const title =
      typeof rawTitle === 'string' && rawTitle.trim()
        ? rawTitle.trim()
        : fileName.replace(/\.[^.]+$/, '');
    const favorite = formData.get('favorite') === 'true';

    const contentType = fileMime.startsWith('image/')
      ? 'image'
      : fileMime.startsWith('video/')
        ? 'video'
        : fileMime.startsWith('audio/')
          ? 'audio'
          : fileMime === 'application/epub+zip'
            ? 'book'
            : 'document';

    return HttpResponse.json(
      makeMockBookmark({
        id: 'bm-file-uploaded',
        storageKind: 'file',
        url: null,
        urlParts: null,
        title,
        favorite,
        contentType,
        fileRef: 'file-ref-uploaded',
        fileName,
        fileMime,
        fileSize,
        cacheStatus:
          fileMime === 'application/pdf' ||
          fileMime === 'text/plain' ||
          fileMime === 'text/markdown' ||
          fileMime === 'application/epub+zip'
            ? 'ready'
            : 'skipped',
        tags: [],
      }),
      { status: 201 },
    );
  }),

  http.get('*/api/v1/files/:id', ({ request, params }) => {
    const auth = request.headers.get('authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return problemJsonResponse(401, {
        code: 'UNAUTHORIZED',
        title: 'Unauthorized',
        detail: 'Missing bearer token',
      });
    }
    const url = new URL(request.url);
    const isDownload = url.searchParams.get('download') === '1';
    const id = String(params.id);
    const disposition = isDownload
      ? `attachment; filename="${id}.bin"; filename*=UTF-8''${encodeURIComponent(`${id}.bin`)}`
      : `inline; filename="${id}.bin"`;

    return new HttpResponse(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': disposition,
      },
    });
  }),

  http.get('*/api/v1/bookmarks', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '24');
    const favorite = url.searchParams.get('favorite');
    const unassignedOnly = url.searchParams.get('unassignedOnly');
    const trashed = url.searchParams.get('trashed');
    const broken = url.searchParams.get('broken');
    const reminder = url.searchParams.get('reminder');

    let items = makeDefaultBookmarkFixtures();
    if (trashed === 'true') {
      items = items.filter((item) => item.deletedAt !== null);
    } else {
      items = items.filter((item) => item.deletedAt === null);
    }
    if (broken === 'true') {
      items = items.filter((item) => item.brokenAt !== null || item.brokenReason !== null);
    }
    if (favorite === 'true') {
      items = items.filter((item) => item.favorite);
    }
    if (unassignedOnly === 'true') {
      items = items.filter((item) => item.id === 'bm-2');
    }
    if (reminder === 'true') {
      items = items.filter((item) => item.reminderAt !== null);
    }
    const cacheStatus = url.searchParams.get('cacheStatus');
    if (cacheStatus) {
      items = items.filter((item) => item.cacheStatus === cacheStatus);
    }
    const domain = url.searchParams.get('domain');
    if (domain) {
      const domainLower = domain.toLowerCase();
      items = items.filter((item) => item.urlParts?.domain?.toLowerCase() === domainLower);
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

  http.post('*/api/v1/bookmarks', async ({ request }) => {
    const url = new URL(request.url);
    const body = (await request.json()) as {
      url?: string;
      title?: string;
      excerpt?: string;
      note?: string;
      favorite?: boolean;
      reminderAt?: string | null;
    };
    const resolvedUrl = body.url ?? url.searchParams.get('url') ?? 'https://arcdrop.test/new';
    const resolvedTitle = body.title ?? url.searchParams.get('title') ?? null;
    const resolvedFavorite =
      body.favorite ?? (url.searchParams.get('favorite') === 'true' ? true : false);
    return HttpResponse.json(
      makeMockBookmark({
        id: 'bm-created',
        url: resolvedUrl,
        title: resolvedTitle,
        excerpt: body.excerpt ?? null,
        note: body.note ?? null,
        favorite: resolvedFavorite,
        reminderAt: body.reminderAt ?? null,
        tags: [],
      }),
      { status: 201 },
    );
  }),

  http.get('*/api/v1/bookmarks/:id', ({ params }) => {
    const id = String(params.id);
    const match = makeDefaultBookmarkFixtures().find((item) => item.id === id);
    return HttpResponse.json(match ?? makeMockBookmark({ id }), { status: 200 });
  }),

  http.get('*/api/v1/bookmarks/:id/archive', ({ params }) => {
    const id = String(params.id);
    return HttpResponse.json(makeMockBookmarkArchive({ bookmarkId: id }), { status: 200 });
  }),

  http.post('*/api/v1/bookmarks/:id/reindex', ({ params }) => {
    const id = String(params.id);
    return HttpResponse.json({ id, status: 'scheduled' as const }, { status: 202 });
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

  http.put('*/api/v1/bookmarks/:id/tags', async ({ params, request }) => {
    const id = String(params.id);
    const body = (await request.json()) as { tags: string[] };
    const existing =
      makeDefaultBookmarkFixtures().find((item) => item.id === id) ?? makeMockBookmark({ id });
    return HttpResponse.json(
      {
        ...existing,
        tags: body.tags.map((name, idx) => ({ id: `tag-${idx + 1}`, name })),
        updatedAt: '2026-11-14T03:02:00.000Z',
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

  http.get('*/api/v1/bookmarks/:id/highlights', () => {
    return HttpResponse.json({ items: [] }, { status: 200 });
  }),

  http.get('*/api/v1/bookmarks/:id/highlights/export', ({ request, params }) => {
    const url = new URL(request.url);
    const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'txt';
    const id = String(params.id);
    const body =
      format === 'csv'
        ? 'text,note,color,createdAt\n"Highlighted snippet","","amber","2026-11-14T00:12:00.000Z"\n'
        : '> Highlighted snippet\n';
    return new HttpResponse(body, {
      status: 200,
      headers: {
        'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="highlights-${id}.${format}"`,
      },
    });
  }),

  http.post('*/api/v1/bookmarks/:id/highlights', async ({ params, request }) => {
    const bookmarkId = String(params.id);
    const body = (await request.json()) as {
      text: string;
      note?: string | null;
      color?: string | null;
    };
    return HttpResponse.json(
      makeMockHighlight({
        id: 'hl-created',
        bookmarkId,
        text: body.text,
        note: body.note ?? null,
        color: body.color ?? null,
      }),
      { status: 201 },
    );
  }),

  http.put('*/api/v1/highlights/:id', async ({ params, request }) => {
    const id = String(params.id);
    const body = (await request.json()) as {
      text?: string;
      note?: string | null;
      color?: string | null;
    };
    return HttpResponse.json(
      makeMockHighlight({
        id,
        text: body.text ?? 'Updated highlight',
        note: body.note ?? null,
        color: body.color ?? null,
        updatedAt: '2026-11-14T03:15:00.000Z',
      }),
      { status: 200 },
    );
  }),

  http.delete('*/api/v1/highlights/:id', () => {
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('*/api/v1/library/duplicates', () => {
    return HttpResponse.json({ groups: [] }, { status: 200 });
  }),

  http.post('*/api/v1/library/duplicates/resolve', async ({ request }) => {
    const body = (await request.json()) as { keepId: string; trashIds: string[] };
    return HttpResponse.json(
      {
        kept: makeMockBookmark({ id: body.keepId }),
        trashedIds: body.trashIds,
      },
      { status: 200 },
    );
  }),

  http.post('*/api/v1/data/import', async () => {
    return HttpResponse.json(makeMockImportSummary(), { status: 200 });
  }),

  http.post('*/api/v1/data/export', async ({ request }) => {
    const body = (await request.json()) as {
      format: 'json' | 'csv' | 'html' | 'txt';
      includeFiles?: boolean;
    };
    const ext = body.includeFiles ? 'zip' : body.format;
    const contentType = body.includeFiles
      ? 'application/zip'
      : body.format === 'json'
        ? 'application/json; charset=utf-8'
        : body.format === 'csv'
          ? 'text/csv; charset=utf-8'
          : body.format === 'html'
            ? 'text/html; charset=utf-8'
            : 'text/plain; charset=utf-8';
    return new HttpResponse('exported-data', {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="arcdrop-export.${ext}"`,
      },
    });
  }),

  http.get('*/api/v1/admin/settings', () => {
    return HttpResponse.json(makeMockSettings(), { status: 200 });
  }),

  http.get('*/api/v1/notifications', () => {
    return HttpResponse.json(
      {
        items: [],
        totalCount: 0,
        page: 1,
        pageSize: 50,
      },
      { status: 200 },
    );
  }),

  http.post('*/api/v1/notifications/read', async ({ request }) => {
    const body = (await request.json()) as { ids?: string[]; all?: boolean };
    return HttpResponse.json(
      {
        updated: body.all ? 1 : (body.ids?.length ?? 0),
      },
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
