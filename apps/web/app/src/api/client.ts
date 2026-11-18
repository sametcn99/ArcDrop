import { z } from 'zod';
import { isWebApiOrigin, resolveDefaultBaseUrl } from './baseUrl';
import { platform } from '../platform';
import { authSessionSchema, type AuthSession } from './schemas/auth';
import { ApiError, problemDetailsSchema, toApiError } from './schemas/problem';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ApiClientHooks {
  onSessionRefreshed?: (session: AuthSession) => void;
  onSessionExpired?: (error: ApiError) => void;
}

export interface ApiClientConfig {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  schema?: z.ZodType<T>;
  skipAuth?: boolean;
  signal?: AbortSignal;
}

export interface BlobRequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  skipAuth?: boolean;
  signal?: AbortSignal;
}

export interface BlobResponse {
  blob: Blob;
  contentType: string;
  contentDisposition: string | null;
  filename: string | null;
}

interface InternalRequestOptions<T> extends RequestOptions<T> {
  _retried?: boolean;
}

interface InternalBlobRequestOptions extends BlobRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  _retried?: boolean;
}

export function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isFinite(timestamp)) {
    const deltaSeconds = Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
    return deltaSeconds;
  }
  return undefined;
}

export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;

  // Prefer RFC 5987 filename*=UTF-8''... over legacy filename="..."
  const starMatch = /filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\r\n]+)/i.exec(header);
  if (starMatch?.[1]) {
    const raw = starMatch[1].trim().replace(/^"(.*)"$/, '$1');
    try {
      const decoded = decodeURIComponent(raw).trim();
      if (decoded) return decoded;
    } catch {
      if (raw) return raw;
    }
  }

  const plainMatch = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;\r\n]+)/i.exec(header);
  const candidate = (plainMatch?.[1] ?? plainMatch?.[2] ?? '').trim();
  return candidate.length > 0 ? candidate : null;
}

// localStorage key holding the rotating refresh token (see createApiClient).
const REFRESH_TOKEN_STORAGE_KEY = 'arcdrop.refreshToken';

function buildApiUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined | null>,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const versionedPath = normalizedPath.startsWith('/api/v1/')
    ? normalizedPath
    : normalizedPath === '/api/v1'
      ? normalizedPath
      : `/api/v1${normalizedPath}`;

  let fullPath = `${baseUrl}${versionedPath}`;
  // Same-origin fallback applies only on plain web origins. Inside a Tauri
  // webview (tauri://localhost or http(s)://tauri.localhost) no API lives at
  // the app origin — the runtime address from onboarding (arcdrop.baseUrl) or
  // build-time env must provide the base URL there.
  if (
    baseUrl === '' &&
    typeof window !== 'undefined' &&
    typeof window.location?.origin === 'string' &&
    isWebApiOrigin(window.location.origin)
  ) {
    fullPath = `${window.location.origin}${versionedPath}`;
  }

  if (!query) return fullPath;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${fullPath}?${qs}` : fullPath;
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  const requestIdHeader = response.headers.get('x-request-id') ?? undefined;
  const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch {
    rawBody = null;
  }

  const parsed = problemDetailsSchema.safeParse(rawBody);
  if (parsed.success) {
    return new ApiError(
      {
        ...parsed.data,
        requestId: parsed.data.requestId ?? requestIdHeader,
      },
      { retryAfterSeconds },
    );
  }

  return new ApiError(
    {
      type: `https://arcdrop.dev/problems/http-${response.status}`,
      title: response.statusText || 'Request Failed',
      status: response.status,
      code: `HTTP_${response.status}`,
      detail:
        typeof rawBody === 'object' &&
        rawBody !== null &&
        'message' in rawBody &&
        typeof rawBody.message === 'string'
          ? rawBody.message
          : response.statusText || `Request failed with status ${response.status}`,
      requestId: requestIdHeader,
    },
    { retryAfterSeconds },
  );
}

export function createApiClient(config: ApiClientConfig = {}) {
  let baseUrl = (config.baseUrl ?? resolveDefaultBaseUrl()).replace(/\/+$/, '');
  // Platform adapter fetch (plan T0): identical to the global fetch in the
  // browser, and the CORS-free plugin-http fetch inside Tauri from T2 on.
  const fetchImpl = config.fetchFn ?? platform.getFetch();

  // The access token lives strictly in memory (never persisted). The refresh
  // token is persisted to localStorage so a page reload can restore the
  // session via POST /auth/refresh — safe here because the API rotates
  // refresh tokens on every use and revokes the whole family when a rotated
  // token is replayed (reuse detection, auth.service.ts).
  let tokens: TokenPair | null = null;
  let inFlightRefresh: Promise<AuthSession> | null = null;
  let hooks: ApiClientHooks = {};

  function readPersistedRefreshToken(): string | null {
    try {
      return window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  function writePersistedRefreshToken(refreshToken: string | null): void {
    try {
      if (refreshToken) {
        window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
      } else {
        window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      }
    } catch {
      // Storage unavailable (private mode, sandboxed origin) — session simply
      // won't survive a reload.
    }
  }

  function setHooks(nextHooks: ApiClientHooks): void {
    hooks = nextHooks;
  }

  function setBaseUrl(nextBaseUrl: string): void {
    baseUrl = nextBaseUrl.trim().replace(/\/+$/, '');
  }

  function getBaseUrl(): string {
    return baseUrl;
  }

  function resolveUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>,
  ): string {
    return buildApiUrl(baseUrl, path, query);
  }

  function setTokens(nextTokens: TokenPair | null): void {
    tokens = nextTokens ? { ...nextTokens } : null;
    writePersistedRefreshToken(tokens?.refreshToken ?? null);
  }

  function clearTokens(): void {
    tokens = null;
    writePersistedRefreshToken(null);
  }

  function getAccessToken(): string | null {
    return tokens?.accessToken ?? null;
  }

  function getRefreshToken(): string | null {
    return tokens?.refreshToken ?? null;
  }

  async function executeRefreshSingleFlight(): Promise<AuthSession> {
    if (inFlightRefresh) {
      return inFlightRefresh;
    }

    const currentRefreshToken = tokens?.refreshToken;
    if (!currentRefreshToken) {
      const error = new ApiError({
        type: 'https://arcdrop.dev/problems/unauthorized',
        title: 'Unauthorized',
        status: 401,
        code: 'UNAUTHORIZED',
        detail: 'Session expired. Please sign in again.',
      });
      setTokens(null);
      hooks.onSessionExpired?.(error);
      throw error;
    }

    inFlightRefresh = (async () => {
      try {
        const session = await requestInternal<AuthSession>('/auth/refresh', {
          method: 'POST',
          body: { refreshToken: currentRefreshToken },
          schema: authSessionSchema,
          skipAuth: true,
          _retried: true,
        });
        // setTokens (not a bare assignment) so the rotated refresh token is
        // persisted for the next reload.
        setTokens({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        });
        hooks.onSessionRefreshed?.(session);
        return session;
      } catch (err) {
        const apiError = toApiError(err);
        setTokens(null);
        hooks.onSessionExpired?.(apiError);
        throw apiError;
      } finally {
        inFlightRefresh = null;
      }
    })();

    return inFlightRefresh;
  }

  async function requestInternal<T>(
    path: string,
    options: InternalRequestOptions<T> = {},
  ): Promise<T> {
    const method = options.method ?? 'GET';
    const url = buildApiUrl(baseUrl, path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      ...options.headers,
    };

    const usedAccessToken = !options.skipAuth ? (tokens?.accessToken ?? null) : null;
    if (usedAccessToken) {
      headers['Authorization'] = `Bearer ${usedAccessToken}`;
    }

    let bodyInit: BodyInit | undefined;
    if (options.body instanceof FormData) {
      // Let fetch / the browser assign the multipart boundary Content-Type automatically.
      bodyInit = options.body;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyInit = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: bodyInit,
        signal: options.signal,
      });
    } catch (error) {
      throw toApiError(error);
    }

    if (response.status === 401 && !options.skipAuth && !options._retried && tokens?.refreshToken) {
      if (tokens.accessToken === usedAccessToken) {
        await executeRefreshSingleFlight();
      }
      return requestInternal<T>(path, { ...options, _retried: true });
    }

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const json: unknown = await response.json();
    if (options.schema) {
      const parsed = options.schema.safeParse(json);
      if (!parsed.success) {
        throw new ApiError({
          type: 'https://arcdrop.dev/problems/invalid-response',
          title: 'Invalid Server Response',
          status: response.status,
          code: 'INVALID_RESPONSE',
          detail: `Response from ${path} failed boundary schema validation: ${parsed.error.message}`,
        });
      }
      return parsed.data;
    }

    return json as T;
  }

  async function requestBlobInternal(
    path: string,
    options: InternalBlobRequestOptions = {},
  ): Promise<BlobResponse> {
    const method = options.method ?? 'GET';
    const url = buildApiUrl(baseUrl, path, options.query);
    const headers: Record<string, string> = {
      Accept: '*/*',
      ...options.headers,
    };

    const usedAccessToken = !options.skipAuth ? (tokens?.accessToken ?? null) : null;
    if (usedAccessToken) {
      headers['Authorization'] = `Bearer ${usedAccessToken}`;
    }

    let bodyInit: BodyInit | undefined;
    if (options.body instanceof FormData) {
      bodyInit = options.body;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyInit = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: bodyInit,
        signal: options.signal,
      });
    } catch (error) {
      throw toApiError(error);
    }

    if (response.status === 401 && !options.skipAuth && !options._retried && tokens?.refreshToken) {
      if (tokens.accessToken === usedAccessToken) {
        await executeRefreshSingleFlight();
      }
      return requestBlobInternal(path, { ...options, _retried: true });
    }

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('content-disposition');
    const contentType =
      response.headers.get('content-type') ?? blob.type ?? 'application/octet-stream';
    const filename = parseContentDispositionFilename(contentDisposition);

    return {
      blob,
      contentType,
      contentDisposition,
      filename,
    };
  }

  return {
    setHooks,
    setBaseUrl,
    getBaseUrl,
    resolveUrl,
    setTokens,
    clearTokens,
    getAccessToken,
    getRefreshToken,
    getPersistedRefreshToken: readPersistedRefreshToken,
    refreshSession: executeRefreshSingleFlight,
    request: <T>(path: string, options?: RequestOptions<T>) => requestInternal<T>(path, options),
    getBlob: (path: string, options?: BlobRequestOptions) =>
      requestBlobInternal(path, { ...options, method: 'GET' }),
    postBlob: (path: string, body?: unknown, options?: BlobRequestOptions) =>
      requestBlobInternal(path, { ...options, method: 'POST', body }),
    get: <T>(path: string, options?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
      requestInternal<T>(path, { ...options, method: 'GET' }),
    post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
      requestInternal<T>(path, { ...options, method: 'POST', body }),
    put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions<T>, 'method' | 'body'>) =>
      requestInternal<T>(path, { ...options, method: 'PUT', body }),
    patch: <T>(
      path: string,
      body?: unknown,
      options?: Omit<RequestOptions<T>, 'method' | 'body'>,
    ) => requestInternal<T>(path, { ...options, method: 'PATCH', body }),
    delete: <T>(path: string, options?: Omit<RequestOptions<T>, 'method'>) =>
      requestInternal<T>(path, { ...options, method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const apiClient = createApiClient();
