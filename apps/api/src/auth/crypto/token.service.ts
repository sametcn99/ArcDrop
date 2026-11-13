import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/** Refresh tokens live ~30 days (plan D2). */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Invite tokens expire after ~24 hours (plan D15). */
export const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Password-reset tokens expire after ~1 hour (plan D15). */
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface OpaqueToken {
  /** The value handed to the client — shown once, never stored. */
  raw: string;
  /** sha256 hex of `raw` — the only representation kept server-side. */
  hash: string;
  expiresAt: Date;
}

/**
 * Opaque one-time token primitives shared by refresh tokens and the
 * invite/reset tokens (plan D2/D15). Tokens are 256 bits of CSPRNG output,
 * base64url-encoded; only their sha256 is stored, so a database leak does
 * not yield usable credentials.
 */
@Injectable()
export class TokenService {
  /** Generate a fresh opaque token expiring `ttlMs` from now. */
  issue(ttlMs: number): OpaqueToken {
    const raw = randomBytes(32).toString('base64url');
    return {
      raw,
      hash: this.hashRaw(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    };
  }

  hashRaw(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** New family id for a fresh login/session. */
  newFamilyId(): string {
    return randomUUID();
  }
}
