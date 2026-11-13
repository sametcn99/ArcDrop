import { describe, expect, it } from 'bun:test';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

describe('PasswordService (@node-rs/argon2 on Bun)', () => {
  const passwords = new PasswordService();

  it('hashes with argon2id and verifies correctly', async () => {
    const hash = await passwords.hash('correct-horse-battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await passwords.verify(hash, 'correct-horse-battery')).toBe(true);
    expect(await passwords.verify(hash, 'wrong-password')).toBe(false);
  });

  it('produces a different hash per call (unique salts)', async () => {
    const [a, b] = await Promise.all([passwords.hash('same-input'), passwords.hash('same-input')]);
    expect(a).not.toBe(b);
    expect(await passwords.verify(a, 'same-input')).toBe(true);
    expect(await passwords.verify(b, 'same-input')).toBe(true);
  });

  it('pins OWASP-recommended parameters in the PHC string', async () => {
    const hash = await passwords.hash('params-check');
    // $argon2id$v=19$m=19456,t=2,p=1$...
    expect(hash).toContain('$v=19$');
    expect(hash).toContain('$m=19456,t=2,p=1$');
  });
});

describe('TokenService (opaque one-time tokens)', () => {
  const tokens = new TokenService();

  it('issues base64url tokens with the requested expiry', () => {
    const before = Date.now();
    const token = tokens.issue(60 * 60 * 1000);
    expect(token.raw).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits
    expect(token.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60 * 1000 - 50);
    expect(token.hash).toBe(tokens.hashRaw(token.raw));
  });

  it('generates unique tokens and new family ids', () => {
    const first = tokens.issue(1000);
    const second = tokens.issue(1000);
    expect(first.raw).not.toBe(second.raw);
    expect(first.hash).not.toBe(second.hash);
    expect(tokens.newFamilyId()).not.toBe(tokens.newFamilyId());
  });

  it('hashes sha256 deterministically', () => {
    expect(tokens.hashRaw('abc')).toBe(tokens.hashRaw('abc'));
    expect(tokens.hashRaw('abc')).toHaveLength(64);
    expect(tokens.hashRaw('abc')).not.toBe(tokens.hashRaw('abd'));
  });
});
