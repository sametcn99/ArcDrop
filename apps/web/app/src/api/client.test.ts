import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { createAuthApi } from './endpoints/auth';
import { createApiClient } from './client';
import { ApiError } from './schemas/problem';
import { makeMockSession, makeMockUser, problemJsonResponse } from '../test/msw/handlers';
import { server } from '../test/msw/server';

describe('API client & auth endpoints', () => {
  it('parses RFC 7807 problem+json responses into ApiError with code and requestId', async () => {
    server.use(
      http.post('*/api/v1/auth/login', () =>
        problemJsonResponse(401, {
          code: 'UNAUTHORIZED',
          title: 'Unauthorized',
          detail: 'Invalid email or password',
          requestId: 'req-abc-123',
        }),
      ),
    );

    const client = createApiClient();
    const authApi = createAuthApi(client);

    await expect(
      authApi.login({ email: 'alice@arcdrop.test', password: 'wrong-password' }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ApiError);
      const apiErr = error as ApiError;
      expect(apiErr.status).toBe(401);
      expect(apiErr.code).toBe('UNAUTHORIZED');
      expect(apiErr.detail).toBe('Invalid email or password');
      expect(apiErr.requestId).toBe('req-abc-123');
      return true;
    });
  });

  it('surfaces 401 TOTP_REQUIRED as a typed totp_required login outcome', async () => {
    server.use(
      http.post('*/api/v1/auth/login', () =>
        problemJsonResponse(401, {
          code: 'TOTP_REQUIRED',
          title: 'Unauthorized',
          detail: 'Two-factor authentication code required',
          challenge: 'challenge-xyz-123',
          expiresAt: '2026-11-14T16:00:00.000Z',
        }),
      ),
    );

    const client = createApiClient();
    const authApi = createAuthApi(client);
    const outcome = await authApi.login({
      email: 'alice@arcdrop.test',
      password: 'correct-password',
    });

    expect(outcome).toEqual({
      kind: 'totp_required',
      challenge: 'challenge-xyz-123',
      expiresAt: '2026-11-14T16:00:00.000Z',
    });
  });

  it('performs single-flight silent refresh with rotation when parallel requests receive 401', async () => {
    vi.useFakeTimers();

    const refreshCalls: Array<{ refreshToken: string }> = [];
    const seenAuthHeaders: string[] = [];

    server.use(
      http.get('*/api/v1/auth/me', ({ request }) => {
        const auth = request.headers.get('authorization') ?? '';
        seenAuthHeaders.push(auth);
        if (auth === 'Bearer access-expired') {
          return problemJsonResponse(401, {
            code: 'UNAUTHORIZED',
            title: 'Unauthorized',
            detail: 'Access token expired',
          });
        }
        if (auth === 'Bearer access-rotated-1') {
          return HttpResponse.json(makeMockUser({ email: 'rotated@arcdrop.test' }), {
            status: 200,
          });
        }
        return problemJsonResponse(401, {
          code: 'UNAUTHORIZED',
          detail: 'Unexpected token',
        });
      }),
      http.post('*/api/v1/auth/refresh', async ({ request }) => {
        const body = (await request.json()) as { refreshToken: string };
        refreshCalls.push(body);
        await new Promise((resolve) => setTimeout(resolve, 100));
        return HttpResponse.json(
          makeMockSession({
            user: { email: 'rotated@arcdrop.test' },
            accessToken: 'access-rotated-1',
            refreshToken: 'refresh-rotated-1',
          }),
          { status: 201 },
        );
      }),
    );

    const client = createApiClient();
    const onRefreshed = vi.fn();
    client.setHooks({ onSessionRefreshed: onRefreshed });
    client.setTokens({
      accessToken: 'access-expired',
      refreshToken: 'refresh-initial-1',
    });

    const authApi = createAuthApi(client);
    const pending = Promise.all([authApi.getMe(), authApi.getMe()]);

    await vi.advanceTimersByTimeAsync(100);
    const [first, second] = await pending;

    expect(first.email).toBe('rotated@arcdrop.test');
    expect(second.email).toBe('rotated@arcdrop.test');
    expect(refreshCalls).toEqual([{ refreshToken: 'refresh-initial-1' }]);
    expect(onRefreshed).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken()).toBe('access-rotated-1');
    expect(client.getRefreshToken()).toBe('refresh-rotated-1');
    expect(seenAuthHeaders).toEqual([
      'Bearer access-expired',
      'Bearer access-expired',
      'Bearer access-rotated-1',
      'Bearer access-rotated-1',
    ]);
  });

  it('clears in-memory tokens and triggers onSessionExpired when refresh fails', async () => {
    server.use(
      http.get('*/api/v1/auth/me', () =>
        problemJsonResponse(401, {
          code: 'UNAUTHORIZED',
          detail: 'Expired access token',
        }),
      ),
      http.post('*/api/v1/auth/refresh', () =>
        problemJsonResponse(401, {
          code: 'UNAUTHORIZED',
          detail: 'Refresh token reuse detected — the session was revoked on all devices',
        }),
      ),
    );

    const client = createApiClient();
    const onExpired = vi.fn();
    client.setHooks({ onSessionExpired: onExpired });
    client.setTokens({
      accessToken: 'access-old',
      refreshToken: 'refresh-reused',
    });

    const authApi = createAuthApi(client);
    await expect(authApi.getMe()).rejects.toBeInstanceOf(ApiError);

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(client.getAccessToken()).toBeNull();
    expect(client.getRefreshToken()).toBeNull();
  });

  it('never writes access or refresh tokens to localStorage or sessionStorage', async () => {
    const localSetSpy = vi.spyOn(Storage.prototype, 'setItem');
    const client = createApiClient();
    const authApi = createAuthApi(client);

    const outcome = await authApi.login({
      email: 'alice@arcdrop.test',
      password: 'password-1234',
    });
    expect(outcome.kind).toBe('authenticated');
    if (outcome.kind === 'authenticated') {
      client.setTokens({
        accessToken: outcome.session.accessToken,
        refreshToken: outcome.session.refreshToken,
      });
    }

    await client.refreshSession();

    expect(localSetSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
