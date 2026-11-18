import { describe, expect, it } from 'bun:test';
import { isTokenUsable, readJwtExpiry } from './jwt';

function jwtWithPayload(payload: Record<string, unknown>): string {
  const encode = (value: string): string =>
    btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const header = encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encode(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('readJwtExpiry', () => {
  it('reads the exp claim as epoch milliseconds', () => {
    const token = jwtWithPayload({ sub: 'u1', exp: 1_700_000_000 });
    expect(readJwtExpiry(token)).toBe(1_700_000_000_000);
  });

  it('returns null for malformed tokens', () => {
    expect(readJwtExpiry('not-a-jwt')).toBeNull();
    expect(readJwtExpiry('a.b')).toBeNull();
    expect(readJwtExpiry('a.!!!.c')).toBeNull();
    expect(readJwtExpiry(jwtWithPayload({ sub: 'no-exp' }))).toBeNull();
  });
});

describe('isTokenUsable', () => {
  const now = 10_000_000;

  it('accepts tokens outside the refresh margin', () => {
    expect(isTokenUsable(now + 60_000, now)).toBe(true);
  });
  it('rejects tokens inside the margin or stale', () => {
    expect(isTokenUsable(now + 20_000, now)).toBe(false);
    expect(isTokenUsable(now - 1_000, now)).toBe(false);
    expect(isTokenUsable(null, now)).toBe(false);
  });
});
