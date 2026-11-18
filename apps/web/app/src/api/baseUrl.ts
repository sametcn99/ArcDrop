import { platform } from '../platform';

/**
 * localStorage key holding the user-entered ArcDrop server address (runtime
 * base URL). Sibling of the existing `arcdrop.refreshToken` storage keys.
 */
export const BASE_URL_STORAGE_KEY = 'arcdrop.baseUrl';

export type ServerValidationFailureReason = 'invalid-url' | 'unreachable' | 'not-arcdrop';

export type ServerValidationResult =
  { ok: true; baseUrl: string } | { ok: false; reason: ServerValidationFailureReason };

/**
 * Candidate paths for the OpenAPI document, in probe order. The ArcDrop API
 * serves the document at the root (`/openapi.json`, see apps/api
 * app-setup.ts); the prefixed `/api/v1/openapi.json` is probed too so
 * validation keeps working if the document ever moves under the versioned
 * prefix.
 */
const OPENAPI_PROBE_PATHS = ['/openapi.json', '/api/v1/openapi.json'] as const;

/**
 * Normalizes a user-entered server address: trims whitespace, prepends
 * `https://` when the scheme is missing and strips trailing slashes.
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return '';
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

/** Reads the stored server address (normalized), or null when absent. */
export function readStoredBaseUrl(): string | null {
  try {
    const stored = window.localStorage.getItem(BASE_URL_STORAGE_KEY);
    if (stored === null) {
      return null;
    }
    const normalized = normalizeBaseUrl(stored);
    return normalized === '' ? null : normalized;
  } catch {
    return null;
  }
}

/** Persists the server address (normalized). Storage failures are non-fatal. */
export function writeStoredBaseUrl(baseUrl: string): void {
  try {
    window.localStorage.setItem(BASE_URL_STORAGE_KEY, normalizeBaseUrl(baseUrl));
  } catch {
    // Storage unavailable (private mode, sandboxed origin) — the caller still
    // applies the address to the in-memory API client for this session.
  }
}

/** Removes the stored server address. */
export function clearStoredBaseUrl(): void {
  try {
    window.localStorage.removeItem(BASE_URL_STORAGE_KEY);
  } catch {
    // Ignore — same rationale as writeStoredBaseUrl.
  }
}

/**
 * True when `origin` is a plain web origin that can plausibly host the API
 * (http/https and not a Tauri webview origin). Tauri v2 serves the bundled
 * frontend from `tauri://localhost` (macOS/Linux/iOS/Android) or
 * `http(s)://tauri.localhost` (Windows) — no ArcDrop API lives there, so the
 * same-origin fallback must not apply.
 */
export function isWebApiOrigin(origin: string): boolean {
  if (typeof origin !== 'string' || origin === '') {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return parsed.hostname.toLowerCase() !== 'tauri.localhost';
}

function envBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL ?? '';
  return envUrl.trim().replace(/\/+$/, '');
}

function defaultOrigin(): string {
  return typeof window !== 'undefined' ? (window.location?.origin ?? '') : '';
}

/**
 * Resolution order for the API base URL: stored runtime address → build-time
 * env → same-origin (`''` — buildApiUrl expands it to window.location.origin
 * when that origin is a usable web origin).
 */
export function resolveDefaultBaseUrl(): string {
  const stored = readStoredBaseUrl();
  if (stored !== null) {
    return stored;
  }
  return envBaseUrl();
}

/**
 * True when a usable API base URL can be resolved without asking the user
 * (stored address, build-time env, or a usable same-origin web origin). When
 * false — e.g. inside a Tauri webview before first setup — the app routes to
 * the server-address onboarding screen.
 */
export function hasResolvedBaseUrl(origin: string = defaultOrigin()): boolean {
  if (readStoredBaseUrl() !== null || envBaseUrl() !== '') {
    return true;
  }
  return isWebApiOrigin(origin);
}

function isOpenApi3Document(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const openapi = (value as { openapi?: unknown }).openapi;
  return typeof openapi === 'string' && openapi.startsWith('3.');
}

/**
 * Validates that `rawInput` points at an ArcDrop API server: normalizes the
 * address, then probes the OpenAPI document (200 with an `openapi: "3.x"`
 * field). Distinguishes unreachable servers from servers that answered but
 * are not ArcDrop. Uses the platform fetch (T2: CORS-free inside Tauri).
 */
export async function validateArcDropServer(
  rawInput: string,
  fetchImpl: typeof fetch = platform.getFetch(),
  timeoutMs = 8_000,
): Promise<ServerValidationResult> {
  const baseUrl = normalizeBaseUrl(rawInput);
  if (baseUrl === '') {
    return { ok: false, reason: 'invalid-url' };
  }
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'invalid-url' };
  }

  let sawResponse = false;
  for (const path of OPENAPI_PROBE_PATHS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      sawResponse = true;
      if (response.status === 200) {
        const document: unknown = await response.json().catch(() => null);
        if (isOpenApi3Document(document)) {
          return { ok: true, baseUrl };
        }
      }
      // Non-200 or a non-OpenAPI body at this path — try the next probe path.
    } catch {
      // Network failure or probe timeout — try the next probe path.
    } finally {
      clearTimeout(timeout);
    }
  }
  return sawResponse ? { ok: false, reason: 'not-arcdrop' } : { ok: false, reason: 'unreachable' };
}
