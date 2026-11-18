import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BASE_URL_STORAGE_KEY,
  clearStoredBaseUrl,
  hasResolvedBaseUrl,
  isWebApiOrigin,
  normalizeBaseUrl,
  readStoredBaseUrl,
  resolveDefaultBaseUrl,
  validateArcDropServer,
  writeStoredBaseUrl,
} from './baseUrl';

function jsonOk(body: unknown): Response {
  return { status: 200, json: async () => body } as unknown as Response;
}

function statusOnly(status: number): Response {
  return { status, json: async () => null } as unknown as Response;
}

describe('normalizeBaseUrl', () => {
  it('adds https:// when the scheme is missing', () => {
    expect(normalizeBaseUrl('arcdrop.example.com')).toBe('https://arcdrop.example.com');
    expect(normalizeBaseUrl('localhost:3000')).toBe('https://localhost:3000');
  });

  it('trims whitespace and strips trailing slashes', () => {
    expect(normalizeBaseUrl('  arcdrop.example.com//  ')).toBe('https://arcdrop.example.com');
    expect(normalizeBaseUrl('https://arcdrop.example.com/')).toBe('https://arcdrop.example.com');
    expect(normalizeBaseUrl('https://arcdrop.example.com/api/')).toBe(
      'https://arcdrop.example.com/api',
    );
  });

  it('keeps an existing scheme untouched', () => {
    expect(normalizeBaseUrl('http://arcdrop.example.com')).toBe('http://arcdrop.example.com');
    expect(normalizeBaseUrl('ftp://files.example.com')).toBe('ftp://files.example.com');
  });

  it('maps empty input to the empty string', () => {
    expect(normalizeBaseUrl('')).toBe('');
    expect(normalizeBaseUrl('   ')).toBe('');
  });
});

describe('isWebApiOrigin', () => {
  it('accepts plain web origins', () => {
    expect(isWebApiOrigin('http://localhost:5173')).toBe(true);
    expect(isWebApiOrigin('https://bookmarks.example.com')).toBe(true);
  });

  it('rejects Tauri webview origins — no API can live there', () => {
    expect(isWebApiOrigin('tauri://localhost')).toBe(false);
    expect(isWebApiOrigin('http://tauri.localhost')).toBe(false);
    expect(isWebApiOrigin('https://tauri.localhost')).toBe(false);
  });

  it('rejects empty, unparseable and non-http(s) origins', () => {
    expect(isWebApiOrigin('')).toBe(false);
    expect(isWebApiOrigin('null')).toBe(false);
    expect(isWebApiOrigin('file:///C:/app/index.html')).toBe(false);
  });
});

describe('stored base URL', () => {
  afterEach(() => {
    clearStoredBaseUrl();
  });

  it('stores, reads and clears the normalized server address', () => {
    expect(readStoredBaseUrl()).toBeNull();

    writeStoredBaseUrl('  arcdrop.example.com// ');
    expect(window.localStorage.getItem(BASE_URL_STORAGE_KEY)).toBe('https://arcdrop.example.com');
    expect(readStoredBaseUrl()).toBe('https://arcdrop.example.com');

    clearStoredBaseUrl();
    expect(readStoredBaseUrl()).toBeNull();
    expect(window.localStorage.getItem(BASE_URL_STORAGE_KEY)).toBeNull();
  });
});

describe('resolveDefaultBaseUrl', () => {
  // Hermetic: vitest loads the developer's .env.local, so the env URL must be
  // pinned to empty for the resolution-order assertions.
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_API_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearStoredBaseUrl();
  });

  it('falls back to the build-time env URL (trimmed, trailing slashes stripped)', () => {
    vi.stubEnv('VITE_API_URL', 'https://env.example.com/');
    expect(resolveDefaultBaseUrl()).toBe('https://env.example.com');
  });

  it('keeps same-origin ("") when nothing is configured', () => {
    expect(resolveDefaultBaseUrl()).toBe('');
  });

  it('prefers the stored runtime address over the env URL', () => {
    vi.stubEnv('VITE_API_URL', 'https://env.example.com');
    writeStoredBaseUrl('stored.example.com');
    expect(resolveDefaultBaseUrl()).toBe('https://stored.example.com');
  });
});

describe('hasResolvedBaseUrl', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', '');
    vi.stubEnv('VITE_API_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    clearStoredBaseUrl();
  });

  it('is false with no stored address, no env and no usable origin', () => {
    expect(hasResolvedBaseUrl('tauri://localhost')).toBe(false);
  });

  it('is true when a stored address exists, even inside a Tauri webview', () => {
    writeStoredBaseUrl('https://stored.example.com');
    expect(hasResolvedBaseUrl('tauri://localhost')).toBe(true);
  });

  it('is true when a build-time env URL exists', () => {
    vi.stubEnv('VITE_API_URL', 'https://env.example.com');
    expect(hasResolvedBaseUrl('tauri://localhost')).toBe(true);
  });

  it('is true on plain web origins via the same-origin fallback', () => {
    expect(hasResolvedBaseUrl('http://localhost:5173')).toBe(true);
    expect(hasResolvedBaseUrl('https://bookmarks.example.com')).toBe(true);
    expect(hasResolvedBaseUrl('http://tauri.localhost')).toBe(false);
    expect(hasResolvedBaseUrl('')).toBe(false);
  });
});

describe('validateArcDropServer', () => {
  it('normalizes the input and validates via the root OpenAPI document', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ openapi: '3.1.0' }));

    const result = await validateArcDropServer('  api.example.com// ', fetchMock, 1_000);

    expect(result).toEqual({ ok: true, baseUrl: 'https://api.example.com' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/openapi.json',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('falls back to the prefixed /api/v1/openapi.json probe', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(statusOnly(404))
      .mockResolvedValueOnce(jsonOk({ openapi: '3.0.3' }));

    const result = await validateArcDropServer('https://api.example.com', fetchMock, 1_000);

    expect(result).toEqual({ ok: true, baseUrl: 'https://api.example.com' });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/openapi.json',
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/api/v1/openapi.json',
      expect.anything(),
    );
  });

  it('reports not-arcdrop when the document is not OpenAPI 3.x', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonOk({ swagger: '2.0' }));

    const result = await validateArcDropServer('https://other.example.com', fetchMock, 1_000);

    expect(result).toEqual({ ok: false, reason: 'not-arcdrop' });
  });

  it('reports not-arcdrop for non-200 answers on every probe path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(statusOnly(404));

    const result = await validateArcDropServer('https://other.example.com', fetchMock, 1_000);

    expect(result).toEqual({ ok: false, reason: 'not-arcdrop' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports unreachable when every probe fails on the network', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await validateArcDropServer('https://down.example.com', fetchMock, 1_000);

    expect(result).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('rejects empty and non-http(s) addresses without any network call', async () => {
    const fetchMock = vi.fn();

    await expect(validateArcDropServer('   ', fetchMock, 100)).resolves.toEqual({
      ok: false,
      reason: 'invalid-url',
    });
    await expect(validateArcDropServer('ftp://files.example.com', fetchMock, 100)).resolves.toEqual(
      { ok: false, reason: 'invalid-url' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
