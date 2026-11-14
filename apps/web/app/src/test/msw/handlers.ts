import { http, HttpResponse } from 'msw';
import type { AuthSession, Session, User } from '../../api/schemas/auth';
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
