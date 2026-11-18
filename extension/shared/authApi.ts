// Auth API calls for the extension, against the real ArcDrop contract:
//   POST /api/v1/auth/login      {email, password, deviceLabel?} → AuthSession
//                                or 401 problem code TOTP_REQUIRED (+challenge)
//   POST /api/v1/auth/login/tfa  {challenge, code?|recoveryCode?}  → AuthSession
//   POST /api/v1/auth/refresh    {refreshToken}                    → AuthSession (rotates)
//   POST /api/v1/auth/logout     {refreshToken}                    → 204 (idempotent)
//   GET  /api/v1/auth/me         bearer                            → User
// Response shapes mirror the API DTOs (apps/api/src/auth/auth.dto.ts) and the
// generated OpenAPI types (apps/web/app/src/api/types.ts, operationIds login /
// loginTfa / refreshTokens / logout / getCurrentUser). E1 wires only these
// five calls; E2+ endpoints should switch to generated types
// (`bun --cwd=extension run generate:api` against a running server).

import { apiUrl, apiFetch } from './apiFetch';
import { ApiError, isTotpRequiredError, toApiError } from './problem';

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  hasPassword: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

/** AuthSessionResponseDto — access JWT + rotating refresh token + user. */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceLabel?: string;
}

export interface LoginTfaInput {
  challenge: string;
  code?: string;
  recoveryCode?: string;
  deviceLabel?: string;
}

export type LoginOutcome =
  | { kind: 'authenticated'; session: AuthSession }
  | { kind: 'totp_required'; challenge: string; expiresAt: string };

export interface AuthApiOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Verifies the address points at an ArcDrop instance. The OpenAPI document is
 * served at the ROOT (`/openapi.json`) — unlike the versioned API under
 * `/api/v1` — and must describe the ArcDrop auth surface.
 */
export async function validateServer(baseUrl: string, options: AuthApiOptions = {}): Promise<void> {
  const base = baseUrl.replace(/\/+$/, '');
  let document: unknown;
  try {
    const result = await apiFetch<unknown>(`${base}/openapi.json`, options);
    document = result.data;
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status === 404) {
      // Some hardened deployments may hide the root document; fall back to
      // the versioned readiness probe that is part of the public API.
      await apiFetch(`${base}/api/v1/readyz`, options);
      return;
    }
    throw apiError;
  }

  if (
    typeof document !== 'object' ||
    document === null ||
    typeof (document as Record<string, unknown>)['openapi'] !== 'string'
  ) {
    throw new ApiError({
      type: 'https://arcdrop.dev/problems/not-arcdrop',
      title: 'Not an ArcDrop server',
      status: 0,
      code: 'NOT_ARCDROP',
      detail: 'The address answered, but it is not an ArcDrop API.',
    });
  }

  const paths = (document as Record<string, unknown>)['paths'];
  if (
    typeof paths !== 'object' ||
    paths === null ||
    typeof (paths as Record<string, unknown>)['/api/v1/auth/login'] !== 'object'
  ) {
    throw new ApiError({
      type: 'https://arcdrop.dev/problems/not-arcdrop',
      title: 'Not an ArcDrop server',
      status: 0,
      code: 'NOT_ARCDROP',
      detail: 'The OpenAPI document does not describe an ArcDrop instance.',
    });
  }
}

/** Step 1 of sign-in; resolves into the 2FA challenge instead of throwing. */
export async function login(
  baseUrl: string,
  input: LoginInput,
  options: AuthApiOptions = {},
): Promise<LoginOutcome> {
  try {
    const result = await apiFetch<AuthSession>(apiUrl(baseUrl, '/auth/login'), {
      method: 'POST',
      body: input,
      ...options,
    });
    return { kind: 'authenticated', session: result.data };
  } catch (error) {
    if (isTotpRequiredError(error)) {
      const apiError = error as ApiError & { challenge: string; expiresAt: string };
      return {
        kind: 'totp_required',
        challenge: apiError.challenge,
        expiresAt: apiError.expiresAt,
      };
    }
    throw error;
  }
}

/** Step 2 with a TOTP or recovery code (uses the challenge from step 1). */
export async function loginTfa(
  baseUrl: string,
  input: LoginTfaInput,
  options: AuthApiOptions = {},
): Promise<AuthSession> {
  const result = await apiFetch<AuthSession>(apiUrl(baseUrl, '/auth/login/tfa'), {
    method: 'POST',
    body: input,
    ...options,
  });
  return result.data;
}

/** Exchanges the refresh token for a fresh pair (rotates server-side). */
export async function refresh(
  baseUrl: string,
  refreshToken: string,
  options: AuthApiOptions = {},
): Promise<AuthSession> {
  const result = await apiFetch<AuthSession>(apiUrl(baseUrl, '/auth/refresh'), {
    method: 'POST',
    body: { refreshToken },
    ...options,
  });
  return result.data;
}

/** Revokes the refresh token (idempotent 204). Never throws to the caller. */
export async function logout(
  baseUrl: string,
  refreshToken: string,
  options: AuthApiOptions = {},
): Promise<void> {
  try {
    await apiFetch(apiUrl(baseUrl, '/auth/logout'), {
      method: 'POST',
      body: { refreshToken },
      ...options,
    });
  } catch {
    // Idempotent server-side; a failed best-effort logout must not block the
    // local disconnect flow.
  }
}

export async function fetchMe(
  baseUrl: string,
  accessToken: string,
  options: AuthApiOptions = {},
): Promise<User> {
  const result = await apiFetch<User>(apiUrl(baseUrl, '/auth/me'), {
    accessToken,
    ...options,
  });
  return result.data;
}

// Compile-time structural alignment against the generated OpenAPI schemas
// (same pattern as apps/web/app/src/api/schemas/auth.ts): when the API
// surface changes and `generate:api` reruns, mismatches break typecheck here.
import type { components } from './api-types.gen';

type _OpenApiAuthSession = components['schemas']['AuthSessionResponseDto'];
const _authSessionCheck: _OpenApiAuthSession | undefined = undefined as AuthSession | undefined;
type _OpenApiUser = components['schemas']['UserDto'];
const _userCheck: _OpenApiUser | undefined = undefined as User | undefined;
void _authSessionCheck;
void _userCheck;
