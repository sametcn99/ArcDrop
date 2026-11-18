import { describe, expect, it } from 'bun:test';
import { ApiError, isApiError } from './problem';
import { apiFetch, apiUrl, parseRetryAfterSeconds } from './apiFetch';

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

describe('apiUrl', () => {
  it('prefixes /api/v1 and strips trailing slashes from the base', () => {
    expect(apiUrl('http://host/', '/auth/login')).toBe('http://host/api/v1/auth/login');
    expect(apiUrl('http://host/sub/arcdrop', 'auth/login')).toBe(
      'http://host/sub/arcdrop/api/v1/auth/login',
    );
  });

  it('keeps already-versioned paths untouched', () => {
    expect(apiUrl('http://host', '/api/v1/auth/me')).toBe('http://host/api/v1/auth/me');
    expect(apiUrl('http://host', '/api/v1')).toBe('http://host/api/v1');
  });
});

describe('parseRetryAfterSeconds', () => {
  it('parses numeric seconds', () => {
    expect(parseRetryAfterSeconds('30')).toBe(30);
    expect(parseRetryAfterSeconds('0')).toBe(0);
  });
  it('parses HTTP dates as a relative delay', () => {
    const future = new Date(Date.now() + 65_000).toUTCString();
    const seconds = parseRetryAfterSeconds(future);
    expect(seconds).toBeGreaterThanOrEqual(60);
    expect(seconds).toBeLessThanOrEqual(66);
  });
  it('returns undefined for junk or null', () => {
    expect(parseRetryAfterSeconds(null)).toBeUndefined();
    expect(parseRetryAfterSeconds('soon')).toBeUndefined();
    expect(parseRetryAfterSeconds('')).toBeUndefined();
  });
});

describe('apiFetch', () => {
  it('returns parsed data with the request id header', async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, { ok: 1 }, { 'x-request-id': 'req-42' })) as unknown as typeof fetch;
    const result = await apiFetch<{ ok: number }>('http://host/api/v1/auth/me', { fetchImpl });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: 1 });
    expect(result.requestId).toBe('req-42');
  });

  it('maps 204 to undefined data', async () => {
    const fetchImpl = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const result = await apiFetch('http://host/api/v1/auth/logout', { fetchImpl });
    expect(result.status).toBe(204);
    expect(result.data).toBeUndefined();
  });

  it('attaches the bearer token and json content type', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return jsonResponse(200, {});
    }) as unknown as typeof fetch;
    await apiFetch('http://host/api/v1/x', {
      fetchImpl,
      accessToken: 'tok',
      body: { a: 1 },
      method: 'POST',
    });
    const headers = captured?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok');
    expect(headers['Content-Type']).toBe('application/json');
    expect(captured?.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('throws ApiError from problem bodies, carrying retry-after and request id', async () => {
    const fetchImpl = (async () =>
      jsonResponse(
        429,
        {
          type: 'https://arcdrop.dev/problems/rate-limited',
          title: 'Too Many Requests',
          status: 429,
          code: 'RATE_LIMITED',
          detail: 'Slow down.',
        },
        { 'retry-after': '7', 'x-request-id': 'req-7' },
      )) as unknown as typeof fetch;
    try {
      await apiFetch('http://host/api/v1/auth/login', { fetchImpl, method: 'POST' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(isApiError(error)).toBe(true);
      const apiError = error as ApiError;
      expect(apiError.code).toBe('RATE_LIMITED');
      expect(apiError.status).toBe(429);
      expect(apiError.retryAfterSeconds).toBe(7);
      expect(apiError.requestId).toBe('req-7');
    }
  });

  it('synthesizes HTTP_<status> for non-problem error bodies', async () => {
    const fetchImpl = (async () =>
      new Response('<html>502</html>', {
        status: 502,
        statusText: 'Bad Gateway',
      })) as unknown as typeof fetch;
    try {
      await apiFetch('http://host/api/v1/x', { fetchImpl });
      throw new Error('should have thrown');
    } catch (error) {
      const apiError = error as ApiError;
      expect(apiError.code).toBe('HTTP_502');
      expect(apiError.requestId).toBeUndefined();
    }
  });

  it('maps fetch rejections to NETWORK_ERROR', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    try {
      await apiFetch('http://host/api/v1/x', { fetchImpl });
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('NETWORK_ERROR');
    }
  });
});
