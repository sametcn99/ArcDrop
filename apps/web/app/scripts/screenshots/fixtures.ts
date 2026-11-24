import { getResponse, http, HttpResponse } from 'msw';
import {
  defaultHandlers,
  makeDefaultBookmarkFixtures,
  makeMockBookmark,
  makeMockCollection,
  makeMockDuplicateGroup,
  makeMockHighlight,
  makeMockNotification,
  makeMockSession,
  makeMockStats,
  makeMockTagUsage,
  makeMockUser,
  problemJsonResponse,
} from '../../src/test/msw/handlers';

export const port = Number(process.env['ARCDROP_SCREENSHOT_PORT'] ?? 4174);
export const origin = `http://127.0.0.1:${port}`;
export const demoEmail = 'demo@arcdrop.test';
export const totpEmail = 'two-factor@arcdrop.test';
export const demoPassword = 'arcdrop-screenshot-fixture-password';
const now = '2026-11-20T12:00:00.000Z';
export const user = makeMockUser({ email: demoEmail, role: 'admin' });
export const refreshToken = 'arcdrop-screenshot-fixture-refresh-token';
const jwtPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
export const accessToken = `eyJhbGciOiJIUzI1NiJ9.${jwtPayload.toString('base64url')}.fixture`;
const session = makeMockSession({ user, accessToken, refreshToken });
const collection = makeMockCollection({
  title: 'Design research',
  color: '#6750a4',
  bookmarkCount: 5,
  share: { enabled: true, shareToken: 'screenshot-demo' },
});
const names = [
  'Designing for small screens',
  'Accessible color and contrast',
  'Field notes from the coast',
  'A guide to editorial typography',
  'Organizing a personal research library',
  'Practical keyboard navigation patterns',
  'Designing dependable sync',
];
const main = makeDefaultBookmarkFixtures().map((bookmark, index) => ({
  ...bookmark,
  url: `https://example.test/library/${index + 1}`,
  note:
    index === 0
      ? '## Research notes\n\n- Keep the library searchable\n- Use descriptive tags\n- Review archived references'
      : bookmark.note,
  favorite: index === 0,
}));
const bookmarks = [
  ...main,
  ...names.map((title, index) =>
    makeMockBookmark({
      id: `demo-${index + 1}`,
      title,
      url: `https://example.test/research/${index + 1}`,
      excerpt: 'Reference material saved to the design research collection.',
      contentType: index % 2 ? 'link' : 'article',
      favorite: index === 1,
      tags: [{ id: 'tag-3', name: 'design' }],
      ...(index === 3 ? { brokenAt: now, brokenReason: 'HTTP 404' } : {}),
    }),
  ),
];
const trashed = makeMockBookmark({
  id: 'trashed-demo',
  title: 'An older research draft',
  deletedAt: now,
});
const notifications = [
  makeMockNotification({
    id: 'notice-demo',
    payload: {
      ...makeMockNotification().payload,
      title: 'Review accessibility references',
      url: 'https://example.test/research/accessibility',
      reminderAt: now,
    },
  }),
];
const sharedCollection = { ...collection, children: [] };
const handlers = [
  http.post('*/api/v1/auth/login', async ({ request }) => {
    const { email } = (await request.json()) as { email: string };
    return email === totpEmail
      ? problemJsonResponse(401, {
          code: 'TOTP_REQUIRED',
          detail: 'Enter the code from your authenticator app.',
          challenge: 'screenshot-totp-challenge',
          expiresAt: '2099-01-01T00:00:00.000Z',
        })
      : HttpResponse.json(session, { status: 201 });
  }),
  http.post('*/api/v1/auth/login/tfa', () => HttpResponse.json(session, { status: 201 })),
  http.post('*/api/v1/auth/refresh', () => HttpResponse.json(session, { status: 201 })),
  http.get('*/api/v1/auth/me', () => HttpResponse.json(user)),
  http.get('*/api/v1/admin/users', () =>
    HttpResponse.json({
      items: [
        user,
        makeMockUser({
          id: '22222222-2222-4222-8222-222222222222',
          email: 'researcher@arcdrop.test',
          totpEnabled: true,
        }),
      ],
    }),
  ),
  http.get('*/api/v1/admin/audit', () =>
    HttpResponse.json({
      items: [
        {
          id: 'audit-demo',
          action: 'admin.user.create',
          actorType: 'jwt',
          userId: user.id,
          patId: null,
          requestId: 'fixture-request',
          subject: 'researcher@arcdrop.test',
          outcome: 'ok',
          detail: null,
          createdAt: now,
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 25,
    }),
  ),
  http.get('*/api/v1/me/tokens', () =>
    HttpResponse.json({
      items: [
        {
          id: 'api-demo',
          name: 'Research assistant',
          readOnly: true,
          createdAt: now,
          lastUsedAt: now,
          revokedAt: null,
        },
      ],
    }),
  ),
  http.get('*/api/v1/collections/tree', () => HttpResponse.json([sharedCollection])),
  http.get('*/api/v1/collections', () => HttpResponse.json({ items: [collection] })),
  http.get('*/api/v1/collections/:id', () => HttpResponse.json(collection)),
  http.get('*/api/v1/bookmarks/stats', () =>
    HttpResponse.json(
      makeMockStats({
        total: bookmarks.length,
        unassigned: 2,
        favorites: 2,
        trashed: 1,
      }),
    ),
  ),
  http.get('*/api/v1/bookmarks/tags', () =>
    HttpResponse.json([
      makeMockTagUsage({ id: 'tag-1', name: 'architecture', count: 1 }),
      makeMockTagUsage({ id: 'tag-2', name: 'sync', count: 1 }),
      makeMockTagUsage({ id: 'tag-3', name: 'design', count: 8 }),
    ]),
  ),
  http.get('*/api/v1/bookmarks', ({ request }) => {
    const query = new URL(request.url).searchParams;
    let items = bookmarks;
    if (query.get('trashed') === 'true') items = [trashed];
    else if (query.get('broken') === 'true') items = bookmarks.filter((item) => item.brokenAt);
    else if (query.get('favorite') === 'true') items = bookmarks.filter((item) => item.favorite);
    else if (query.has('collectionId')) items = bookmarks.slice(0, 5);
    const search = query.get('search') ?? query.get('q');
    if (search && !search.includes(':')) {
      items = items.filter((item) => item.title?.toLowerCase().includes(search.toLowerCase()));
    }
    return HttpResponse.json({
      items,
      totalCount: items.length,
      page: Number(query.get('page') ?? 1),
      pageSize: Number(query.get('pageSize') ?? 25),
    });
  }),
  http.get('*/api/v1/bookmarks/:id', ({ params }) =>
    HttpResponse.json(bookmarks.find((item) => item.id === params['id']) ?? main[0]),
  ),
  http.get('*/api/v1/bookmarks/:id/highlights', () =>
    HttpResponse.json({
      items: [
        makeMockHighlight({ text: 'Keep research material searchable and easy to revisit.' }),
      ],
    }),
  ),
  http.get('*/api/v1/library/duplicates', () =>
    HttpResponse.json({ groups: [makeMockDuplicateGroup()] }),
  ),
  http.get('*/api/v1/notifications', () =>
    HttpResponse.json({
      items: notifications,
      totalCount: notifications.length,
      unreadCount: 1,
      page: 1,
      pageSize: 25,
    }),
  ),
  http.get('*/api/v1/public/collections/screenshot-demo', () =>
    HttpResponse.json({
      collection: sharedCollection,
      collectionPath: collection.title,
      items: bookmarks
        .slice(0, 3)
        .map(({ title, url, excerpt, coverRef, iconRef, contentType, createdAt, tags }) => ({
          title,
          url,
          excerpt,
          coverRef,
          iconRef,
          contentType,
          createdAt,
          tags: tags.map(({ name }) => name),
        })),
      totalCount: 3,
      page: 1,
      pageSize: 50,
    }),
  ),
  ...defaultHandlers,
];

export async function fixtureResponse(request: Request): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  if (pathname === '/openapi.json') {
    return Response.json({
      openapi: '3.0.3',
      info: { title: 'ArcDrop API', version: '0.1.0' },
      paths: { '/api/v1/auth/login': { post: {} } },
    });
  }
  if (/^\/sample\/\d+$/.test(pathname)) {
    return new Response(
      '<!doctype html><title>Design research demo</title><h1>Design research demo</h1>',
      {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  }
  if (pathname.startsWith('/api/v1/')) {
    const response = await getResponse(handlers, request);
    if (process.env['ARCDROP_SCREENSHOT_TRACE'])
      console.log(request.method, pathname, response?.status);
    if (response) return response;
    console.warn(`Missing screenshot fixture: ${request.method} ${pathname}`);
    return Response.json({ detail: 'Missing screenshot fixture' }, { status: 404 });
  }
  return undefined;
}
