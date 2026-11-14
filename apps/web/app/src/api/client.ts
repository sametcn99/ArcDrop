import { z } from 'zod';
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

interface InternalRequestOptions<T> extends RequestOptions<T> {
  _retried?: boolean;
}

function resolveDefaultBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? '';
  return envUrl.trim().replace(/\/+$/, '');
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
  if (
    baseUrl === '' &&
    typeof window !== 'undefined' &&
    typeof window.location?.origin === 'string' &&
    /^https?:\/\//.test(window.location.origin)
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
  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch {
    rawBody = null;
  }

  const parsed = problemDetailsSchema.safeParse(rawBody);
  if (parsed.success) {
    return new ApiError({
      ...parsed.data,
      requestId: parsed.data.requestId ?? requestIdHeader,
    });
  }

  return new ApiError({
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
  });
}

export function createApiClient(config: ApiClientConfig = {}) {
  let baseUrl = (config.baseUrl ?? resolveDefaultBaseUrl()).replace(/\/+$/, '');
  const fetchImpl = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  // Strictly in-memory token storage (never persisted to localStorage/sessionStorage).
  let tokens: TokenPair | null = null;
  let inFlightRefresh: Promise<AuthSession> | null = null;
  let hooks: ApiClientHooks = {};

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
  }

  function clearTokens(): void {
    tokens = null;
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
      tokens = null;
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
        tokens = {
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        };
        hooks.onSessionRefreshed?.(session);
        return session;
      } catch (err) {
        const apiError = toApiError(err);
        tokens = null;
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
    if (options.body !== undefined) {
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
      // If another in-flight refresh already rotated the access token after this
      // request was dispatched, retry directly with the fresh token; otherwise
      // join or start the single-flight refresh.
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

  return {
    setHooks,
    setBaseUrl,
    getBaseUrl,
    resolveUrl,
    setTokens,
    clearTokens,
    getAccessToken,
    getRefreshToken,
    refreshSession: executeRefreshSingleFlight,
    request: <T>(path: string, options?: RequestOptions<T>) => requestInternal<T>(path, options),
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
