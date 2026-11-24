import { z } from 'zod';
import { BASE_URL_STORAGE_KEY, isWebApiOrigin, resolveDefaultBaseUrl } from './baseUrl';
import { platform } from '../platform';
import { detectExtension } from '../platform/extension';
import {
  isBrowserSessionEvent,
  LEGACY_REFRESH_KEY,
  readBrowserSession,
  writeBrowserSession,
} from './browserSession';
import { authSessionSchema, type AuthSession } from './schemas/auth';
import { ApiError, problemDetailsSchema, toApiError } from './schemas/problem';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface ApiClientHooks {
  onSessionRefreshed?: (session: AuthSession) => void;
  onSessionExpired?: (error: ApiError) => void;
  onSessionChanged?: () => void;
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

  const browser = !platform.isTauri && !detectExtension();
  const locks = typeof navigator !== 'undefined' && browser ? navigator.locks : undefined;
  const lockName = 'arcdrop:browser-session';
  let tokens: TokenPair | null = null;
  let browserSessionId: string | null = null;
  let generation = 0;
  let inFlightRefresh: Promise<AuthSession> | null = null;
  let pendingLogout: { generation: number; rotatedToken?: string } | null = null;
  let hooks: ApiClientHooks = {};

  function readLegacyToken(): string | null {
    try {
      return window.localStorage.getItem(LEGACY_REFRESH_KEY);
    } catch {
      return null;
    }
  }

  function writeLegacyToken(refreshToken: string | null): void {
    try {
      if (refreshToken) window.localStorage.setItem(LEGACY_REFRESH_KEY, refreshToken);
      else window.localStorage.removeItem(LEGACY_REFRESH_KEY);
    } catch {
      // With unavailable storage, the session lives in memory.
    }
  }

  function serverKey(): string {
    return baseUrl || window.location.origin;
  }

  function readPersistedRefreshToken(): string | null {
    if (!browser) return readLegacyToken();
    if (!locks) return null;
    const stored = readBrowserSession();
    if (stored) return stored.server === serverKey() ? stored.refreshToken : null;
    return browserSessionId === null ? readLegacyToken() : null;
  }

  function setHooks(nextHooks: ApiClientHooks): void {
    hooks = nextHooks;
  }

  function forgetLocalSession(): void {
    generation++;
    tokens = null;
    browserSessionId = null;
    inFlightRefresh = null;
  }

  function setBaseUrl(nextBaseUrl: string): void {
    const normalized = nextBaseUrl.trim().replace(/\/+$/, '');
    if (normalized !== baseUrl) {
      if (locks && readBrowserSession()?.server === serverKey()) writeBrowserSession(null);
      clearTokens();
      baseUrl = normalized;
      hooks.onSessionChanged?.();
    }
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
    if (nextTokens === null) {
      clearTokens();
      return;
    }
    forgetLocalSession();
    tokens = { ...nextTokens };
    if (!browser) {
      writeLegacyToken(tokens.refreshToken);
    } else if (locks) {
      const id = crypto.randomUUID();
      if (writeBrowserSession({ id, server: serverKey(), refreshToken: tokens.refreshToken })) {
        browserSessionId = id;
        writeLegacyToken(null);
      }
    }
  }

  function clearTokens(): void {
    if (!browser) {
      writeLegacyToken(null);
    } else if (locks) {
      const stored = readBrowserSession();
      if (stored?.id === browserSessionId) writeBrowserSession(null);
      if (!stored) writeLegacyToken(null);
    }
    forgetLocalSession();
  }

  function handleStorageEvent(event: StorageEvent): void {
    if (browser && (event.key === BASE_URL_STORAGE_KEY || event.key === null)) {
      const next = resolveDefaultBaseUrl();
      if (next !== baseUrl) {
        baseUrl = next;
        forgetLocalSession();
        hooks.onSessionChanged?.();
        return;
      }
    }
    if (!locks || !isBrowserSessionEvent(event) || !browserSessionId) return;
    const stored = readBrowserSession();
    if (stored?.id !== browserSessionId) {
      forgetLocalSession();
      hooks.onSessionChanged?.();
    }
  }

  function getAccessToken(): string | null {
    return tokens?.accessToken ?? null;
  }

  function getRefreshToken(): string | null {
    return tokens?.refreshToken ?? null;
  }

  function sessionChanged(): ApiError {
    return new ApiError({
      type: 'https://arcdrop.dev/problems/session-changed',
      title: 'Session changed',
      status: 409,
      code: 'SESSION_CHANGED',
      detail: 'The active session changed.',
    });
  }

  async function refresh(started: number): Promise<AuthSession> {
    if (started !== generation) throw sessionChanged();

    // Read under the cross-tab lock, so no request can replay a token just
    // rotated by another tab. The id stays stable across rotations.
    const server = browser && locks ? serverKey() : null;
    const stored = server ? readBrowserSession() : null;
    if (
      stored &&
      (stored.server !== server || (browserSessionId && stored.id !== browserSessionId))
    ) {
      forgetLocalSession();
      hooks.onSessionChanged?.();
      throw sessionChanged();
    }
    if (browserSessionId && !stored) {
      forgetLocalSession();
      hooks.onSessionChanged?.();
      throw sessionChanged();
    }
    const legacy = !browser || (server && !stored) ? readLegacyToken() : null;
    const refreshToken = stored?.refreshToken ?? tokens?.refreshToken ?? legacy;
    if (!refreshToken) {
      throw new ApiError({
        type: 'https://arcdrop.dev/problems/unauthorized',
        title: 'Unauthorized',
        status: 401,
        code: 'UNAUTHORIZED',
        detail: 'Session expired. Please sign in again.',
      });
    }

    const originalSession = (): boolean => {
      if (!server) return true;
      const current = readBrowserSession();
      return stored ? current?.id === stored.id : current === null && readLegacyToken() === legacy;
    };

    try {
      const session = await requestInternal<AuthSession>('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        schema: authSessionSchema,
        skipAuth: true,
        _retried: true,
      });
      if (!originalSession()) {
        if (started === generation) {
          forgetLocalSession();
          hooks.onSessionChanged?.();
        }
        throw sessionChanged();
      }
      if (started !== generation) {
        if (pendingLogout?.generation === started)
          pendingLogout.rotatedToken = session.refreshToken;
        throw sessionChanged();
      }

      tokens = { accessToken: session.accessToken, refreshToken: session.refreshToken };
      if (server) {
        const id = stored?.id ?? crypto.randomUUID();
        browserSessionId = writeBrowserSession({ id, server, refreshToken: session.refreshToken })
          ? id
          : null;
        if (browserSessionId) writeLegacyToken(null);
      } else if (!browser && !detectExtension()) {
        writeLegacyToken(session.refreshToken);
      }
      hooks.onSessionRefreshed?.(session);
      return session;
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.status === 401 && started === generation && originalSession()) {
        if (stored) writeBrowserSession(null);
        if (!stored && legacy) writeLegacyToken(null);
        clearTokens();
        hooks.onSessionExpired?.(apiError);
      }
      throw apiError;
    }
  }

  function executeRefreshSingleFlight(): Promise<AuthSession> {
    if (inFlightRefresh) return inFlightRefresh;

    const started = generation;
    const attempt = (
      locks ? locks.request(lockName, () => refresh(started)) : refresh(started)
    ).finally(() => {
      if (inFlightRefresh === attempt) inFlightRefresh = null;
    });
    inFlightRefresh = attempt;
    return attempt;
  }

  async function endSession(): Promise<void> {
    const outstanding = inFlightRefresh;
    const stored = locks ? readBrowserSession() : null;
    const ownedId = browserSessionId ?? (stored?.server === serverKey() ? stored?.id : null);
    const token = tokens?.refreshToken ?? readPersistedRefreshToken();
    const endpoint = buildApiUrl(baseUrl, '/auth/logout');
    const logout = { generation, rotatedToken: undefined as string | undefined };
    pendingLogout = logout;
    forgetLocalSession();
    const invalidate = async () => {
      const latest = locks ? readBrowserSession() : null;
      const ownsStoredSession = latest !== null && latest.id === ownedId;
      if (ownsStoredSession) writeBrowserSession(null);
      if (generation === logout.generation + 1 && !latest) writeLegacyToken(null);
      const refreshToken = logout.rotatedToken ?? (ownsStoredSession ? latest.refreshToken : token);
      if (refreshToken) {
        await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      }
    };
    try {
      if (locks) await locks.request(lockName, invalidate);
      else {
        await outstanding?.catch(() => {});
        await invalidate();
      }
    } finally {
      if (pendingLogout === logout) pendingLogout = null;
    }
  }

  async function requestInternal<T>(
    path: string,
    options: InternalRequestOptions<T> = {},
  ): Promise<T> {
    const started = generation;
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

    if (!options.skipAuth && started !== generation) throw sessionChanged();
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
    const started = generation;
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

    if (!options.skipAuth && started !== generation) throw sessionChanged();
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
    endSession,
    handleStorageEvent,
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
