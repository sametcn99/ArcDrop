import { beforeEach, describe, expect, it } from 'bun:test';
import { createAuthBroker } from './authBroker';
import { readVault, writeVault, type StorageLike } from '../shared/vault';

interface RouteHandler {
  (init?: RequestInit): Response | Promise<Response>;
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

function fakePermissions(granted: boolean) {
  return {
    request: async () => granted,
    contains: async () => granted,
  };
}

function fakeFetch(routes: Record<string, RouteHandler>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    for (const [suffix, handler] of Object.entries(routes)) {
      if (url.endsWith(suffix)) {
        return await handler(init);
      }
    }
    throw new TypeError(`Unexpected URL: ${url}`);
  }) as typeof fetch;
  return { impl, calls };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function encodePayload(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function makeToken(expiresInSeconds: number): string {
  return `header.${encodePayload({ exp: expiresInSeconds })}.sig`;
}

const ARCDROP_DOC = {
  openapi: '3.1.0',
  info: { title: 'ArcDrop API', version: '0.1.0' },
  paths: { '/api/v1/auth/login': { post: {} } },
};

function sessionFixture(expiresInSeconds: number, refreshToken: string) {
  return {
    accessToken: makeToken(expiresInSeconds),
    refreshToken,
    user: {
      id: 'u1',
      email: 'me@example.com',
      role: 'user',
      status: 'active',
      hasPassword: true,
      totpEnabled: false,
      createdAt: '2026-01-01T00:00:00Z',
    },
  };
}

let now: number;
let area: StorageLike;

beforeEach(() => {
  now = 1_000_000_000_000;
  area = fakeStorage();
});

function broker(routes: Record<string, RouteHandler>, permissionGranted = true) {
  const fetcher = fakeFetch(routes);
  const brokerInstance = createAuthBroker({
    area,
    permissions: fakePermissions(permissionGranted),
    fetchImpl: fetcher.impl,
    now: () => now,
    getDeviceLabel: () => 'Extension · Chrome',
  });
  return { ...brokerInstance, calls: fetcher.calls };
}

const AUTH_ROUTES: Record<string, RouteHandler> = {
  '/openapi.json': () => jsonResponse(200, ARCDROP_DOC),
  '/auth/login/tfa': () => jsonResponse(201, sessionFixture(now / 1000 + 900, 'r1')),
  '/auth/login': () => jsonResponse(201, sessionFixture(now / 1000 + 900, 'r1')),
  '/auth/refresh': () => jsonResponse(201, sessionFixture(now / 1000 + 900, 'r2')),
  '/auth/logout': () => new Response(null, { status: 204 }),
};

describe('authBroker', () => {
  it('reports the initial disconnected state', async () => {
    const result = await broker(AUTH_ROUTES).handleMessage({ type: 'auth/state' });
    expect(result).toEqual({
      ok: true,
      kind: 'state',
      baseUrl: null,
      connected: false,
      email: null,
    });
  });

  it('validates a server and stores the normalized address', async () => {
    const instance = broker(AUTH_ROUTES);
    const result = await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000/',
    });
    expect(result).toEqual({ ok: true, kind: 'validated' });
    expect((await readVault(area)).baseUrl).toBe('http://localhost:3000');
    expect(instance.calls.some((url) => url.endsWith('/openapi.json'))).toBe(true);
  });

  it('refuses validation without the host permission', async () => {
    const result = await broker(AUTH_ROUTES, false).handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    expect(result).toMatchObject({ ok: false, code: 'HOST_PERMISSION_DENIED' });
  });

  it('rejects servers that are not ArcDrop', async () => {
    const result = await broker({
      '/openapi.json': () => jsonResponse(200, { openapi: '3.1.0', paths: {} }),
    }).handleMessage({ type: 'auth/validate-server', serverUrl: 'http://localhost:3000' });
    expect(result).toMatchObject({ ok: false, code: 'NOT_ARCDROP' });
  });

  it('logs in, stores the session and serves the cached access token', async () => {
    const instance = broker(AUTH_ROUTES);
    await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    const loginResult = await instance.handleMessage({
      type: 'auth/login',
      email: 'me@example.com',
      password: 'correct-horse-battery',
    });
    expect(loginResult).toEqual({ ok: true, kind: 'authenticated', email: 'me@example.com' });

    const vault = await readVault(area);
    expect(vault.refreshToken).toBe('r1');
    expect(vault.user).toEqual(sessionFixture(now / 1000 + 900, 'r1').user);
    expect(vault.accessTokenExpiresAt).toBe(now + 900_000);

    const tokenResult = await instance.handleMessage({ type: 'auth/access-token' });
    const freshVault = await readVault(area);
    const cachedToken = freshVault.accessToken;
    if (cachedToken === null) {
      throw new Error('expected a cached token after login');
    }
    expect(tokenResult).toEqual({
      ok: true,
      kind: 'access-token',
      accessToken: cachedToken,
      refreshToken: 'r1',
      user: sessionFixture(now / 1000 + 900, 'r1').user,
      baseUrl: 'http://localhost:3000',
    });
    // No refresh call was needed for the fresh token.
    expect(instance.calls.some((url) => url.endsWith('/auth/refresh'))).toBe(false);
  });

  it('surfaces the TOTP challenge instead of failing the login', async () => {
    const instance = broker({
      '/openapi.json': () => jsonResponse(200, ARCDROP_DOC),
      '/auth/login': () =>
        jsonResponse(401, {
          type: 'https://arcdrop.dev/problems/totp-required',
          title: 'TOTP required',
          status: 401,
          code: 'TOTP_REQUIRED',
          detail: 'Enter your authenticator code.',
          challenge: 'c-token',
          expiresAt: '2026-01-01T00:05:00Z',
        }),
    });
    await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    const result = await instance.handleMessage({
      type: 'auth/login',
      email: 'me@example.com',
      password: 'correct-horse-battery',
    });
    expect(result).toEqual({
      ok: true,
      kind: 'totp-required',
      challenge: 'c-token',
      expiresAt: '2026-01-01T00:05:00Z',
    });
  });

  it('surfaces UNAUTHORIZED for wrong credentials (live contract)', async () => {
    const instance = broker({
      '/openapi.json': () => jsonResponse(200, ARCDROP_DOC),
      '/auth/login': () =>
        jsonResponse(401, {
          type: 'https://arcdrop.dev/problems/unauthorized',
          title: 'Unauthorized',
          status: 401,
          code: 'UNAUTHORIZED',
          detail: 'Invalid email or password',
        }),
    });
    await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    const result = await instance.handleMessage({
      type: 'auth/login',
      email: 'me@example.com',
      password: 'wrong-password-123',
    });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHORIZED', status: 401 });
  });

  it('completes the 2FA step and stores the session', async () => {
    const instance = broker(AUTH_ROUTES);
    await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    const result = await instance.handleMessage({
      type: 'auth/login-tfa',
      challenge: 'c-token',
      code: '123456',
    });
    expect(result).toEqual({ ok: true, kind: 'authenticated', email: 'me@example.com' });
    expect((await readVault(area)).refreshToken).toBe('r1');
  });

  it('refreshes once when the cached token goes stale (single flight)', async () => {
    const instance = broker(AUTH_ROUTES);
    await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    await instance.handleMessage({
      type: 'auth/login',
      email: 'me@example.com',
      password: 'correct-horse-battery',
    });

    now += 900_000 + 31_000; // past the 30 s margin

    const tokenResult = await instance.handleMessage({ type: 'auth/access-token' });
    expect(tokenResult.ok).toBe(true);
    if (tokenResult.ok && tokenResult.kind === 'access-token') {
      const vault = await readVault(area);
      const rotatedToken = vault.accessToken;
      if (rotatedToken === null) {
        throw new Error('expected the refreshed token to be stored');
      }
      expect(tokenResult.accessToken).toBe(rotatedToken);
      expect(vault.refreshToken).toBe('r2');
    }
    expect(instance.calls.filter((url) => url.endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('clears the session when the refresh token is rejected', async () => {
    const instance = broker({
      '/openapi.json': () => jsonResponse(200, ARCDROP_DOC),
      '/auth/login': () => jsonResponse(201, sessionFixture(now / 1000 + 900, 'r1')),
      '/auth/refresh': () =>
        jsonResponse(401, {
          type: 'https://arcdrop.dev/problems/unauthorized',
          title: 'Unauthorized',
          status: 401,
          code: 'UNAUTHORIZED',
          detail: 'Token family revoked.',
        }),
    });
    await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    await instance.handleMessage({
      type: 'auth/login',
      email: 'me@example.com',
      password: 'correct-horse-battery',
    });

    now += 950_000;
    const result = await instance.handleMessage({ type: 'auth/access-token' });
    expect(result).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

    const vault = await readVault(area);
    expect(vault.refreshToken === null).toBe(true);
    expect(vault.baseUrl === 'http://localhost:3000').toBe(true);
  });

  it('disconnects: revokes server-side and clears tokens, keeps baseUrl', async () => {
    const instance = broker(AUTH_ROUTES);
    await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    await instance.handleMessage({
      type: 'auth/login',
      email: 'me@example.com',
      password: 'correct-horse-battery',
    });

    const result = await instance.handleMessage({ type: 'auth/disconnect' });
    expect(result).toEqual({ ok: true, kind: 'disconnected' });
    expect(instance.calls.some((url) => url.endsWith('/auth/logout'))).toBe(true);

    const vault = await readVault(area);
    expect(vault.refreshToken).toBeNull();
    expect(vault.user).toBeNull();
    expect(vault.baseUrl).toBe('http://localhost:3000');
  });

  it('disconnect is safe without a session', async () => {
    const result = await broker(AUTH_ROUTES).handleMessage({ type: 'auth/disconnect' });
    expect(result).toEqual({ ok: true, kind: 'disconnected' });
  });

  it('rejects access-token requests when not connected', async () => {
    await writeVault(area, { baseUrl: 'http://localhost:3000' });
    const result = await broker(AUTH_ROUTES).handleMessage({ type: 'auth/access-token' });
    expect(result).toMatchObject({ ok: false, code: 'SESSION_EXPIRED' });
    expect(await readVault(area)).toMatchObject({ refreshToken: null });
  });

  it('answers unknown messages with a failure', async () => {
    const result = await broker(AUTH_ROUTES).handleMessage({ type: 'auth/nope' });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_MESSAGE' });
  });

  it('ingests an app-side session (validated by one broker refresh)', async () => {
    const instance = broker(AUTH_ROUTES);
    await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    const result = await instance.handleMessage({
      type: 'auth/ingest-session',
      refreshToken: 'app-side-token',
    });
    expect(result).toEqual({ ok: true, kind: 'session-ingested', email: 'me@example.com' });
    expect(instance.calls.some((url) => url.endsWith('/auth/refresh'))).toBe(true);
    const vault = await readVault(area);
    // The presented token is rotated server-side — the vault stores the
    // rotated one (app facade gets it back through the mirror).
    expect(vault.refreshToken).toBe('r2');
    expect(vault.user?.email).toBe('me@example.com');
  });

  it('rejects ingest without a token', async () => {
    const instance = broker(AUTH_ROUTES);
    await instance.handleMessage({
      type: 'auth/validate-server',
      serverUrl: 'http://localhost:3000',
    });
    const result = await instance.handleMessage({ type: 'auth/ingest-session', refreshToken: '' });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
