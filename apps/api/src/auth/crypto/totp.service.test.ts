import { describe, expect, it } from 'bun:test';
import { AppConfigService } from '@api/config/app-config.service';
import {
  decodeBase32,
  encodeBase32,
  generateTotp,
  normalizeRecoveryCode,
  TotpService,
} from './totp.service';

function makeTotpService(secret = 'unit-test-secret-0123456789abcdef0123456789'): TotpService {
  const config = new AppConfigService({
    database: { url: 'postgres://irrelevant:irrelevant@localhost:5432/irrelevant' },
    jwt: { secret },
    port: 3000,
    cors: { origins: [] },
    dataDir: '/data',
    metrics: { enabled: false },
    metadata: { enabled: false, allowPrivate: false },
    mcp: { patRequestsPerMinute: 300 },
    portability: { importMaxBytes: 26_214_400, importZipMaxBytes: 314_572_800 },
    rateLimit: {
      importPerMinute: 30,
      reindexPerMinute: 30,
      mcpToolsPerMinute: 300,
      bulkPerMinute: 30,
      publicPerMinute: 60,
    },
    log: { level: 'fatal' },
  });
  return new TotpService(config);
}

// RFC 6238 Appendix B test seeds ("12345678901234567890" extended per hash).
const RFC_SEED_SHA1 = Buffer.from('3132333435363738393031323334353637383930', 'hex');
const RFC_SEED_SHA256 = Buffer.from(
  '3132333435363738393031323334353637383930313233343536373839303132',
  'hex',
);
const RFC_SEED_SHA512 = Buffer.from(
  '31323334353637383930313233343536373839303132333435363738393031323334353637383930313233343536373839303132333435363738393031323334',
  'hex',
);

const RFC_6238_VECTORS: ReadonlyArray<{
  unixSeconds: number;
  sha1: string;
  sha256: string;
  sha512: string;
}> = [
  { unixSeconds: 59, sha1: '94287082', sha256: '46119246', sha512: '90693936' },
  { unixSeconds: 1111111109, sha1: '07081804', sha256: '68084774', sha512: '25091201' },
  { unixSeconds: 1111111111, sha1: '14050471', sha256: '67062674', sha512: '99943326' },
  { unixSeconds: 1234567890, sha1: '89005924', sha256: '91819424', sha512: '93441116' },
  { unixSeconds: 2000000000, sha1: '69279037', sha256: '90698825', sha512: '38618901' },
  { unixSeconds: 20000000000, sha1: '65353130', sha256: '77737706', sha512: '47863826' },
];

describe('TotpService (RFC 4648 Base32, RFC 6238 TOTP, AES-256-GCM)', () => {
  it('matches RFC 6238 Appendix B 8-digit test vectors across SHA1, SHA256, SHA512', () => {
    for (const vec of RFC_6238_VECTORS) {
      const timestampMs = vec.unixSeconds * 1000;
      expect(generateTotp(RFC_SEED_SHA1, { timestampMs, digits: 8, algorithm: 'sha1' })).toBe(
        vec.sha1,
      );
      expect(generateTotp(RFC_SEED_SHA256, { timestampMs, digits: 8, algorithm: 'sha256' })).toBe(
        vec.sha256,
      );
      expect(generateTotp(RFC_SEED_SHA512, { timestampMs, digits: 8, algorithm: 'sha512' })).toBe(
        vec.sha512,
      );
    }
  });

  it('matches standard Base32 RFC 4648 vectors and rejects invalid characters', () => {
    expect(encodeBase32(Buffer.from('foobar', 'utf8'))).toBe('MZXW6YTBOI');
    expect(decodeBase32('MZXW6YTBOI').toString('utf8')).toBe('foobar');
    expect(decodeBase32('mzxw-6ytb oi======').toString('utf8')).toBe('foobar');
    expect(() => decodeBase32('INVALID1!')).toThrow();
  });

  it('verifies 6-digit TOTP codes within +/-1 step window and rejects outside/malformed', () => {
    const totp = makeTotpService();
    const secret = totp.generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    const raw = decodeBase32(secret);
    const t0 = 1_700_000_015_000;
    const codeAtT0 = generateTotp(raw, { timestampMs: t0 });

    // Same step, -1 step (-30s), +1 step (+30s) all succeed.
    expect(totp.verifyCode(secret, codeAtT0, { timestampMs: t0 })).toBe(true);
    expect(totp.verifyCode(secret, codeAtT0, { timestampMs: t0 - 30_000 })).toBe(true);
    expect(totp.verifyCode(secret, codeAtT0, { timestampMs: t0 + 30_000 })).toBe(true);

    // +/-2 steps fail.
    expect(totp.verifyCode(secret, codeAtT0, { timestampMs: t0 - 60_000 })).toBe(false);
    expect(totp.verifyCode(secret, codeAtT0, { timestampMs: t0 + 60_000 })).toBe(false);

    // Non-6-digit or wrong digits fail.
    expect(totp.verifyCode(secret, '12345', { timestampMs: t0 })).toBe(false);
    expect(totp.verifyCode(secret, 'abcdef', { timestampMs: t0 })).toBe(false);
    const wrong = String((Number(codeAtT0) + 1) % 1_000_000).padStart(6, '0');
    expect(totp.verifyCode(secret, wrong, { timestampMs: t0 })).toBe(false);
  });

  it('builds a valid otpauth URI with issuer, account name, and parameters', () => {
    const totp = makeTotpService();
    const secret = 'JBSWY3DPEHPK3PXP';
    const uri = totp.buildOtpauthUri({
      accountName: 'alice@example.com',
      secretBase32: secret,
    });
    const parsed = new URL(uri);
    expect(parsed.protocol).toBe('otpauth:');
    expect(parsed.hostname).toBe('totp');
    expect(decodeURIComponent(parsed.pathname)).toBe('/ArcDrop:alice@example.com');
    expect(parsed.searchParams.get('secret')).toBe(secret);
    expect(parsed.searchParams.get('issuer')).toBe('ArcDrop');
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1');
    expect(parsed.searchParams.get('digits')).toBe('6');
    expect(parsed.searchParams.get('period')).toBe('30');
  });

  it('encrypts and decrypts secrets with AES-256-GCM and rejects tampering', () => {
    const totp = makeTotpService();
    const secret = totp.generateSecret();
    const encrypted = totp.encryptSecret(secret);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(encrypted).not.toContain(secret);
    expect(totp.decryptSecret(encrypted)).toBe(secret);

    // Different key rejects.
    const otherTotp = makeTotpService('different-secret-0123456789abcdef0123456789');
    expect(() => otherTotp.decryptSecret(encrypted)).toThrow();

    // Tampered ciphertext rejects.
    const parts = encrypted.split('.');
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -2)}AA`;
    expect(() => totp.decryptSecret(tampered)).toThrow();
  });

  it('generates unique recovery codes and normalizes hyphen/case on hash', () => {
    const totp = makeTotpService();
    const codes = totp.generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes.map((c) => c.raw)).size).toBe(10);
    for (const { raw, hash } of codes) {
      expect(raw).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(totp.hashRecoveryCode(raw.toUpperCase())).toBe(hash);
      expect(totp.hashRecoveryCode(raw.replace('-', ' '))).toBe(hash);
      expect(normalizeRecoveryCode(` ${raw.toUpperCase()} `)).toBe(raw.replace('-', ''));
    }
  });
});
