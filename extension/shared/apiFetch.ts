// Extension fetch layer for the ArcDrop API (MV3).
// Mirrors the request/error conventions of apps/web/app/src/api/client.ts
// (kept in sync by hand — see shared/problem.ts). Differences by design:
// - the base URL comes from the vault (user-configured server), not env vars;
// - no in-layer token refresh: the background auth broker owns refresh
//   single-flight, so this layer surfaces 401s instead of retrying;
// - against a host-permission-granted origin the fetch bypasses CORS.

import { ApiError, parseProblemDetails, toApiError } from './problem';

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface ApiResult<T = unknown> {
  status: number;
  data: T;
  requestId?: string;
}

/** Parses the Retry-After header (seconds or HTTP-date), like the web client. */
export function parseRetryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  }
  const timestamp = Date.parse(trimmed);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
  }
  return undefined;
}

/**
 * Joins a normalized server base URL with an API path. The API lives under
 * `/api/v1`; a path already carrying the prefix passes through untouched.
 */
export function apiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const versioned =
    normalizedPath === '/api/v1' || normalizedPath.startsWith('/api/v1/')
      ? normalizedPath
      : `/api/v1${normalizedPath}`;
  return `${base}${versioned}`;
}

/**
 * Performs one API request and maps every failure to {@link ApiError}:
 * transport failures become NETWORK_ERROR (status 0), non-2xx responses are
 * parsed as ProblemJSON (with a synthetic HTTP_<status> fallback when the
 * body is not a problem document).
 */
export async function apiFetch<T = unknown>(
  url: string,
  options: ApiFetchOptions = {},
): Promise<ApiResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const method = options.method ?? 'GET';

  const headers: Record<string, string> = {
    Accept: 'application/json, application/problem+json',
    ...options.headers,
  };
  if (options.accessToken) {
    headers['Authorization'] = `Bearer ${options.accessToken}`;
  }

  let bodyInit: BodyInit | undefined;
  if (options.body instanceof FormData) {
    // Let fetch / the browser assign the multipart boundary Content-Type.
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

  const requestId = response.headers.get('x-request-id') ?? undefined;

  if (!response.ok) {
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
    let rawBody: unknown = null;
    try {
      rawBody = await response.json();
    } catch {
      rawBody = null;
    }
    const problem = parseProblemDetails(rawBody) ?? {
      type: `https://arcdrop.dev/problems/http-${response.status}`,
      title: response.statusText || 'Request Failed',
      status: response.status,
      code: `HTTP_${response.status}`,
      detail:
        typeof rawBody === 'object' &&
        rawBody !== null &&
        typeof (rawBody as Record<string, unknown>)['message'] === 'string'
          ? ((rawBody as Record<string, unknown>)['message'] as string)
          : response.statusText || `Request failed with status ${response.status}`,
      requestId,
    };
    throw new ApiError({ ...problem, requestId }, { retryAfterSeconds });
  }

  if (response.status === 204) {
    return { status: 204, data: undefined as T, requestId };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw toApiError(error);
  }
  return { status: response.status, data: data as T, requestId };
}
