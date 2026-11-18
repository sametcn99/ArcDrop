// Minimal access-JWT inspection. The API returns the raw access token from
// login/refresh without a separate expiry field, so the `exp` claim of the
// HS256 JWT is the source of truth for "when must this token be refreshed".

/**
 * Returns the token's `exp` claim in epoch milliseconds, or null when the
 * token is not a well-formed JWT (or carries no exp). Never throws.
 */
export function readJwtExpiry(accessToken: string): number | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const payload = parts[1];
  if (payload === undefined || payload.length === 0) {
    return null;
  }

  try {
    // base64url → base64 (atob only understands the standard alphabet).
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = atob(padded);
    // Payload is UTF-8 percent-decodable; Latin-1 via atob breaks non-ASCII.
    const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    const claim = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof claim !== 'object' || claim === null) return null;
    const exp = (claim as Record<string, unknown>)['exp'];
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** True when `expiresAt` is missing/stale or inside the refresh margin. */
export function isTokenUsable(expiresAt: number | null, now: number, marginMs = 30_000): boolean {
  if (expiresAt === null) return false;
  return expiresAt - marginMs > now;
}
