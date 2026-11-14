import { describe, expect, it } from 'bun:test';
import {
  PAT_PREFIX,
  hashPersonalAccessToken,
  isPersonalAccessToken,
  mintPersonalAccessToken,
} from './pat-token';
import { createHash } from 'node:crypto';

describe('personal access token primitives (M7)', () => {
  it('mints `arcdrop_pat_` + 43 base64url chars (256-bit)', () => {
    const raw = mintPersonalAccessToken();
    expect(raw.startsWith(PAT_PREFIX)).toBe(true);
    expect(raw.length).toBe(PAT_PREFIX.length + 43);
    expect(/^arcdrop_pat_[A-Za-z0-9_-]+$/.test(raw)).toBe(true);
  });

  it('mints unpredictable, unique tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(mintPersonalAccessToken());
    expect(seen.size).toBe(100);
  });

  it('recognizes PATs by prefix and never mistakes JWTs for them', () => {
    expect(isPersonalAccessToken(mintPersonalAccessToken())).toBe(true);
    expect(isPersonalAccessToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.sig')).toBe(false);
    expect(isPersonalAccessToken('arcdrop_pat_')).toBe(true);
    expect(isPersonalAccessToken('')).toBe(false);
    expect(isPersonalAccessToken('not_a_pat_arcdrop_pat_x')).toBe(false);
  });

  it('hashes as sha256 hex — the raw value is never stored', () => {
    const raw = mintPersonalAccessToken();
    const hash = hashPersonalAccessToken(raw);
    expect(hash).toBe(createHash('sha256').update(raw).digest('hex'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different tokens (no collisions on mint)', () => {
    const a = hashPersonalAccessToken(mintPersonalAccessToken());
    const b = hashPersonalAccessToken(mintPersonalAccessToken());
    expect(a).not.toBe(b);
  });
});
