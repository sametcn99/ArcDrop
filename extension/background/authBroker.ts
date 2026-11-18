// The auth broker: the background service worker is the single point that
// (a) talks to the server's auth endpoints, (b) writes the token vault, and
// (c) hands out valid access tokens. The popup and the future E3 app page
// reach it via chrome.runtime.sendMessage (shared/messages.ts).
//
// Refresh is single-flight: while one refresh is in flight, concurrent
// access-token requests await the same promise instead of racing rotations
// (rotation + reuse-detection on the server revokes families on replay).

import * as authApi from '../shared/authApi';
import type { AuthBrokerRequest, AuthBrokerResponse } from '../shared/messages';
import { readJwtExpiry } from '../shared/jwt';
import { ApiError, toApiError } from '../shared/problem';
import { normalizeServerUrl } from '../shared/serverUrl';
import { deviceLabel } from '../shared/deviceLabel';
import {
  clearSession,
  isSessionActive,
  readVault,
  writeVault,
  type StorageLike,
} from '../shared/vault';
import { hasOriginPermission, type PermissionsLike } from '../shared/hostPermissions';

export interface AuthBrokerDeps {
  area: StorageLike;
  permissions?: PermissionsLike;
  fetchImpl?: typeof fetch;
  now?: () => number;
  getDeviceLabel?: () => string;
}

function failureFromApiError(error: unknown): Extract<AuthBrokerResponse, { ok: false }> {
  const apiError = toApiError(error);
  return {
    ok: false,
    code: apiError.code,
    message: apiError.detail.length > 0 ? apiError.detail : apiError.title,
    status: apiError.status > 0 ? apiError.status : undefined,
    requestId: apiError.requestId,
    retryAfterSeconds: apiError.retryAfterSeconds,
    challenge: apiError.challenge,
    expiresAt: apiError.expiresAt,
  };
}

function failure(code: string, message: string): Extract<AuthBrokerResponse, { ok: false }> {
  return { ok: false, code, message };
}

export function createAuthBroker(deps: AuthBrokerDeps) {
  const { area } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const permissions = deps.permissions;
  const now = deps.now ?? Date.now;
  const getDeviceLabel = deps.getDeviceLabel ?? deviceLabel;
  const apiOptions = { fetchImpl };

  let inFlightRefresh: Promise<string> | null = null;

  async function writeSession(session: authApi.AuthSession): Promise<void> {
    await writeVault(area, {
      accessToken: session.accessToken,
      accessTokenExpiresAt: readJwtExpiry(session.accessToken),
      refreshToken: session.refreshToken,
      user: session.user,
    });
  }

  /**
   * Returns an access token that is valid for at least another moment:
   * cached when still fresh (30 s margin), refreshed otherwise. Throws
   * ApiError (SESSION_EXPIRED after a rejected refresh, NETWORK_ERROR on
   * transport failures).
   */
  function getValidAccessToken(): Promise<string> {
    if (inFlightRefresh) {
      return inFlightRefresh;
    }

    inFlightRefresh = (async () => {
      const vault = await readVault(area);
      if (!vault.baseUrl || !vault.refreshToken) {
        throw new ApiError({
          type: 'https://arcdrop.dev/problems/unauthorized',
          title: 'Not connected',
          status: 0,
          code: 'SESSION_EXPIRED',
          detail: 'Not connected to a server yet.',
        });
      }

      if (
        vault.accessToken !== null &&
        vault.accessTokenExpiresAt !== null &&
        vault.accessTokenExpiresAt - 30_000 > now()
      ) {
        return vault.accessToken;
      }

      try {
        const session = await authApi.refresh(vault.baseUrl, vault.refreshToken, apiOptions);
        await writeSession(session);
        return session.accessToken;
      } catch (error) {
        const apiError = toApiError(error);
        // A rejected refresh token means the session (family) is gone:
        // clean up so the UI returns to sign-in. Transport errors keep the
        // session and can be retried later.
        if (apiError.status === 401 || apiError.status === 403) {
          await clearSession(area);
        }
        throw apiError;
      } finally {
        inFlightRefresh = null;
      }
    })();

    return inFlightRefresh;
  }

  async function handleValidateServer(serverUrl: unknown): Promise<AuthBrokerResponse> {
    if (typeof serverUrl !== 'string') {
      return failure('VALIDATION', 'Missing server address.');
    }
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized.ok) {
      return failure('VALIDATION', 'Invalid server address.');
    }
    if (permissions && !(await hasOriginPermission(permissions, normalized.origin))) {
      return failure('HOST_PERMISSION_DENIED', 'Server access permission is missing.');
    }

    await authApi.validateServer(normalized.url, apiOptions);
    await writeVault(area, { baseUrl: normalized.url });
    return { ok: true, kind: 'validated' };
  }

  async function handleLogin(email: unknown, password: unknown): Promise<AuthBrokerResponse> {
    if (typeof email !== 'string' || typeof password !== 'string') {
      return failure('VALIDATION', 'Missing credentials.');
    }
    const vault = await readVault(area);
    if (!vault.baseUrl) {
      return failure('SESSION_EXPIRED', 'No server configured yet.');
    }

    const outcome = await authApi.login(
      vault.baseUrl,
      { email, password, deviceLabel: getDeviceLabel() },
      apiOptions,
    );
    if (outcome.kind === 'totp_required') {
      return {
        ok: true,
        kind: 'totp-required',
        challenge: outcome.challenge,
        expiresAt: outcome.expiresAt,
      };
    }
    await writeSession(outcome.session);
    return { ok: true, kind: 'authenticated', email: outcome.session.user.email };
  }

  async function handleLoginTfa(
    challenge: unknown,
    code: unknown,
    recoveryCode: unknown,
  ): Promise<AuthBrokerResponse> {
    if (typeof challenge !== 'string') {
      return failure('VALIDATION', 'Missing 2FA challenge.');
    }
    if (typeof code !== 'string' && typeof recoveryCode !== 'string') {
      return failure('VALIDATION', 'Provide a code.');
    }
    const vault = await readVault(area);
    if (!vault.baseUrl) {
      return failure('SESSION_EXPIRED', 'No server configured yet.');
    }

    const session = await authApi.loginTfa(
      vault.baseUrl,
      {
        challenge,
        ...(typeof code === 'string' ? { code } : {}),
        ...(typeof recoveryCode === 'string' ? { recoveryCode } : {}),
        deviceLabel: getDeviceLabel(),
      },
      apiOptions,
    );
    await writeSession(session);
    return { ok: true, kind: 'authenticated', email: session.user.email };
  }

  async function handleDisconnect(): Promise<AuthBrokerResponse> {
    const vault = await readVault(area);
    if (vault.baseUrl && vault.refreshToken) {
      await authApi.logout(vault.baseUrl, vault.refreshToken, apiOptions);
    }
    await clearSession(area);
    return { ok: true, kind: 'disconnected' };
  }

  async function handleMessageInner(message: unknown): Promise<AuthBrokerResponse> {
    if (typeof message !== 'object' || message === null) {
      return failure('INVALID_MESSAGE', 'Unknown request.');
    }
    const request = message as { type?: unknown };
    if (typeof request['type'] !== 'string') {
      return failure('INVALID_MESSAGE', 'Unknown request.');
    }

    switch (request['type'] as AuthBrokerRequest['type']) {
      case 'auth/state': {
        const vault = await readVault(area);
        return {
          ok: true,
          kind: 'state',
          baseUrl: vault.baseUrl,
          connected: isSessionActive(vault),
          email: vault.user?.email ?? null,
        };
      }
      case 'auth/validate-server': {
        return handleValidateServer((message as { serverUrl?: unknown })['serverUrl']);
      }
      case 'auth/login': {
        const body = message as { email?: unknown; password?: unknown };
        return handleLogin(body['email'], body['password']);
      }
      case 'auth/login-tfa': {
        const body = message as { challenge?: unknown; code?: unknown; recoveryCode?: unknown };
        return handleLoginTfa(body['challenge'], body['code'], body['recoveryCode']);
      }
      case 'auth/disconnect': {
        return handleDisconnect();
      }
      case 'auth/access-token': {
        try {
          const accessToken = await getValidAccessToken();
          const freshVault = await readVault(area);
          return {
            ok: true,
            kind: 'access-token',
            accessToken,
            refreshToken: freshVault.refreshToken,
            user: freshVault.user,
            baseUrl: freshVault.baseUrl,
          };
        } catch (error) {
          return failureFromApiError(error);
        }
      }
      case 'auth/ingest-session': {
        // E3 embedded-app bridge: the app page signed in (or restored) with
        // its own client and wrote its refresh token into localStorage —
        // adopt it as the vault session so popup/background/app share ONE
        // session. Validation = a single broker-owned refresh round-trip.
        const refreshToken = (message as { refreshToken?: unknown })['refreshToken'];
        if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
          return failure('VALIDATION', 'Missing refresh token.');
        }
        const currentVault = await readVault(area);
        if (!currentVault.baseUrl) {
          return failure('SESSION_EXPIRED', 'No server configured yet.');
        }
        const session = await authApi.refresh(currentVault.baseUrl, refreshToken, apiOptions);
        await writeSession(session);
        return { ok: true, kind: 'session-ingested', email: session.user.email };
      }
      default:
        return failure('INVALID_MESSAGE', 'Unknown request type.');
    }
  }

  return {
    // ApiErrors (network, NOT_ARCDROP, rate limits, …) become failure
    // responses so the popup can render them; anything else crashing the
    // handler surfaces in the router as BROKER_CRASH.
    handleMessage: (message: unknown): Promise<AuthBrokerResponse> =>
      handleMessageInner(message).catch((error: unknown) => failureFromApiError(error)),
    getValidAccessToken,
  };
}

export type AuthBroker = ReturnType<typeof createAuthBroker>;
