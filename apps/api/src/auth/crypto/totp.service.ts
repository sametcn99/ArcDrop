import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@api/config/app-config.service';

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;
export const TFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const RECOVERY_CODE_COUNT = 10;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_LOOKUP = new Map<string, number>([...BASE32_ALPHABET].map((char, idx) => [char, idx]));

export function encodeBase32(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  let output = '';
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      output += BASE32_ALPHABET[(buffer >>> bitsLeft) & 0x1f];
    }
  }
  if (bitsLeft > 0) {
    output += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }
  return output;
}

export function decodeBase32(encoded: string): Buffer {
  const cleaned = encoded.replace(/[\s=-]+/g, '').toUpperCase();
  if (cleaned.length === 0) return Buffer.alloc(0);

  const bytes: number[] = [];
  let buffer = 0;
  let bitsLeft = 0;

  for (const char of cleaned) {
    const val = BASE32_LOOKUP.get(char);
    if (val === undefined) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >>> bitsLeft) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/**
 * RFC 4226 HOTP / RFC 6238 TOTP primitives implemented directly on
 * `node:crypto` — same zero-dependency security posture as `JwtService`.
 */
export function generateHotp(
  secret: Buffer,
  counter: number | bigint,
  digits: number = TOTP_DIGITS,
  algorithm: TotpAlgorithm = 'sha1',
): string {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter), 0);

  const hmac = createHmac(algorithm, secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = binary % 10 ** digits;
  return String(otp).padStart(digits, '0');
}

export function generateTotp(
  secret: Buffer,
  options: {
    timestampMs?: number;
    periodSeconds?: number;
    digits?: number;
    algorithm?: TotpAlgorithm;
  } = {},
): string {
  const timestampMs = options.timestampMs ?? Date.now();
  const periodSeconds = options.periodSeconds ?? TOTP_PERIOD_SECONDS;
  const digits = options.digits ?? TOTP_DIGITS;
  const algorithm = options.algorithm ?? 'sha1';

  const counter = Math.floor(timestampMs / 1000 / periodSeconds);
  return generateHotp(secret, counter, digits, algorithm);
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toLowerCase();
}

export interface GeneratedRecoveryCode {
  raw: string;
  hash: string;
}

/**
 * TOTP & recovery-code crypto helper (plan M15).
 *
 * Hand-rolled on `node:crypto` (RFC 4226 HOTP, RFC 6238 TOTP, RFC 4648 Base32)
 * with AES-256-GCM encryption at rest for TOTP shared secrets and sha256
 * hashing for single-use recovery codes.
 */
@Injectable()
export class TotpService {
  constructor(private readonly config: AppConfigService) {}

  /** Generates a 160-bit (20-byte) Base32-encoded TOTP secret. */
  generateSecret(): string {
    return encodeBase32(randomBytes(20));
  }

  /** Builds a standard `otpauth://totp/...` URI for authenticator apps. */
  buildOtpauthUri(input: { accountName: string; secretBase32: string; issuer?: string }): string {
    const issuer = input.issuer ?? 'ArcDrop';
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(input.accountName)}`;
    const params = new URLSearchParams({
      secret: input.secretBase32,
      issuer,
      algorithm: 'SHA1',
      digits: String(TOTP_DIGITS),
      period: String(TOTP_PERIOD_SECONDS),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  /** Verifies a 6-digit TOTP code across `[step - window, step + window]`. */
  verifyCode(
    secretBase32: string,
    code: string,
    options: {
      timestampMs?: number;
      periodSeconds?: number;
      digits?: number;
      algorithm?: TotpAlgorithm;
      window?: number;
    } = {},
  ): boolean {
    const digits = options.digits ?? TOTP_DIGITS;
    const normalized = code.trim();
    if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) {
      return false;
    }

    const secret = decodeBase32(secretBase32);
    if (secret.length === 0) return false;

    const timestampMs = options.timestampMs ?? Date.now();
    const periodSeconds = options.periodSeconds ?? TOTP_PERIOD_SECONDS;
    const algorithm = options.algorithm ?? 'sha1';
    const window = options.window ?? TOTP_WINDOW;

    const currentCounter = Math.floor(timestampMs / 1000 / periodSeconds);
    const givenBuf = Buffer.from(normalized, 'utf8');

    let matched = false;
    for (let offset = -window; offset <= window; offset++) {
      const counter = currentCounter + offset;
      if (counter < 0) continue;
      const expected = generateHotp(secret, counter, digits, algorithm);
      const expectedBuf = Buffer.from(expected, 'utf8');
      if (expectedBuf.length === givenBuf.length && timingSafeEqual(expectedBuf, givenBuf)) {
        matched = true;
      }
    }
    return matched;
  }

  /** Encrypts a Base32 secret for DB storage using AES-256-GCM. */
  encryptSecret(secretBase32: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(secretBase32, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  /** Decrypts a stored `v1:...` encrypted TOTP secret. */
  decryptSecret(encoded: string): string {
    if (!encoded.startsWith('v1:')) {
      throw new Error('Unsupported encrypted TOTP secret format');
    }
    const parts = encoded.slice(3).split('.');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted TOTP secret');
    }
    const [ivB64, tagB64, ciphertextB64] = parts as [string, string, string];
    const iv = Buffer.from(ivB64, 'base64url');
    const tag = Buffer.from(tagB64, 'base64url');
    const ciphertext = Buffer.from(ciphertextB64, 'base64url');

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Generates single-use `xxxxx-xxxxx` recovery codes + their sha256 hashes. */
  generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): GeneratedRecoveryCode[] {
    const codes: GeneratedRecoveryCode[] = [];
    for (let i = 0; i < count; i++) {
      const hex = randomBytes(5).toString('hex');
      const raw = `${hex.slice(0, 5)}-${hex.slice(5)}`;
      codes.push({ raw, hash: this.hashRecoveryCode(raw) });
    }
    return codes;
  }

  hashRecoveryCode(code: string): string {
    return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
  }

  private encryptionKey(): Buffer {
    return createHash('sha256')
      .update(`arcdrop:totp-secret:v1:${this.config.snapshot.jwt.secret}`)
      .digest();
  }
}
