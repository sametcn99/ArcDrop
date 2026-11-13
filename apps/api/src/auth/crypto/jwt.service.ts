import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '@api/config/app-config.service';

/**
 * Minimal HS256 access-token signing/verification (plan D2: bearer-only,
 * 15-minute access JWTs). Deliberately hand-rolled on `node:crypto` instead
 * of pulling in a JWT library — the algorithm is pinned to HS256 on BOTH
 * sign and verify (an attacker-controlled `alg` header can never switch the
 * verification path), signatures are compared with `timingSafeEqual`, and
 * `exp` is enforced.
 *
 * Claims: `iss` (fixed), `sub` (user id), `fam` (refresh-token family the
 * session belongs to), `iat`, `exp`, `jti`. The guard still loads the user
 * from the database on every request, so disabled users lose access
 * immediately regardless of unexpired tokens.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

interface JwtPayload extends AccessTokenClaims {
  iss: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Refresh-token family id this access token was minted in. */
  fam: string;
}

@Injectable()
export class JwtService {
  constructor(private readonly config: AppConfigService) {}

  sign(claims: AccessTokenClaims, ttlSeconds: number = ACCESS_TOKEN_TTL_SECONDS): string {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: JwtPayload = {
      iss: 'arcdrop',
      iat: now,
      exp: now + ttlSeconds,
      jti: randomUUID(),
      ...claims,
    };
    const signingInput =
      `${Buffer.from(JSON.stringify(header)).toString('base64url')}.` +
      `${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
    const signature = this.hmac(signingInput).toString('base64url');
    return `${signingInput}.${signature}`;
  }

  verify(token: string): AccessTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed access token');
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

    let header: { alg?: string };
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as {
        alg?: string;
      };
    } catch {
      throw new UnauthorizedException('Malformed access token');
    }
    if (header.alg !== 'HS256') {
      throw new UnauthorizedException('Unsupported token algorithm');
    }

    const expected = this.hmac(`${encodedHeader}.${encodedPayload}`);
    const given = Buffer.from(encodedSignature, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('Invalid access token');
    }

    let payload: JwtPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Malformed access token');
    }
    if (
      payload.iss !== 'arcdrop' ||
      typeof payload.sub !== 'string' ||
      typeof payload.fam !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new UnauthorizedException('Invalid access token');
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Access token expired');
    }
    return { sub: payload.sub, fam: payload.fam };
  }

  private hmac(input: string): Buffer {
    return createHmac('sha256', this.config.snapshot.jwt.secret).update(input).digest();
  }
}
