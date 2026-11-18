// Message protocol between the popup (and the future E3 app page) and the
// background auth broker. The popup never touches the network or writes the
// vault; it asks the broker. Responses are plain serializable objects.

import type { BrokerFailure } from './brokerTypes';
import type { VaultUser } from './vault';

export type AuthBrokerRequest =
  | { type: 'auth/state' }
  | { type: 'auth/validate-server'; serverUrl: string }
  | { type: 'auth/login'; email: string; password: string }
  | { type: 'auth/login-tfa'; challenge: string; code?: string; recoveryCode?: string }
  | { type: 'auth/disconnect' }
  | { type: 'auth/access-token' }
  /** E3 embedded-app bridge: adopt a session the app page created itself. */
  | { type: 'auth/ingest-session'; refreshToken: string };

export type AuthBrokerResponse =
  | {
      ok: true;
      kind: 'state';
      baseUrl: string | null;
      connected: boolean;
      email: string | null;
    }
  | { ok: true; kind: 'validated' }
  | { ok: true; kind: 'authenticated'; email: string }
  | { ok: true; kind: 'totp-required'; challenge: string; expiresAt: string }
  | { ok: true; kind: 'disconnected' }
  | {
      ok: true;
      kind: 'access-token';
      accessToken: string;
      /** Full current session for the embedded-app bridge (E3). */
      refreshToken: string | null;
      user: VaultUser | null;
      baseUrl: string | null;
    }
  | { ok: true; kind: 'session-ingested'; email: string }
  | BrokerFailure;

export interface AuthStateView {
  baseUrl: string | null;
  connected: boolean;
  email: string | null;
}

/**
 * Sends one broker request from an extension page and resolves the response.
 * Rejects only when messaging itself fails (no receiver, channel closed).
 */
export async function sendAuthMessage(message: AuthBrokerRequest): Promise<AuthBrokerResponse> {
  const response: unknown = await chrome.runtime.sendMessage(message);
  if (
    typeof response !== 'object' ||
    response === null ||
    typeof (response as Record<string, unknown>)['ok'] !== 'boolean'
  ) {
    throw new Error('Invalid auth broker response');
  }
  return response as AuthBrokerResponse;
}
