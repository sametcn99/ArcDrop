import { createHash, randomBytes } from 'node:crypto';

/**
 * Raw personal access token format (M7): `arcdrop_pat_` + 32 random bytes,
 * base64url (256-bit, CSPRNG — same discipline as refresh/one-time tokens).
 * The prefix makes PATs unambiguous against access JWTs (three dot-separated
 * base64 segments) and leak-scannable in logs/secrets reports.
 */
export const PAT_PREFIX = 'arcdrop_pat_';

export function isPersonalAccessToken(value: string): boolean {
  return value.startsWith(PAT_PREFIX);
}

/** Mint a fresh raw PAT — shown to the caller exactly once, never stored. */
export function mintPersonalAccessToken(): string {
  return PAT_PREFIX + randomBytes(32).toString('base64url');
}

/** sha256 hex of the raw token — the only representation kept server-side. */
export function hashPersonalAccessToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
