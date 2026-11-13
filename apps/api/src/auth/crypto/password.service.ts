import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Password hashing (plan M2): argon2id via `@node-rs/argon2` — a prebuilt
 * napi binding with no node-gyp toolchain, verified to work on Bun 1.4.2
 * (hash + verify exercised on Windows and in CI before this module shipped).
 *
 * Parameters are the OWASP-recommended minimums (m=19456 KiB, t=2, p=1),
 * which are also the library defaults — pinned explicitly so a future
 * dependency bump cannot silently weaken them.
 */
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

@Injectable()
export class PasswordService {
  hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }

  /** True when `plain` matches the stored PHC hash; never throws on mismatch. */
  verify(storedHash: string, plain: string): Promise<boolean> {
    return verify(storedHash, plain, ARGON2_OPTIONS);
  }
}
