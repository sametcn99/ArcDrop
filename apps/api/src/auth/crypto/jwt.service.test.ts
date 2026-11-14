import { describe, expect, it } from 'bun:test';
import { AppConfigService } from '@api/config/app-config.service';
import { AccessTokenClaims, JwtService } from './jwt.service';

function makeJwtService(secret: string): JwtService {
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
    },
    log: { level: 'fatal' },
  });
  return new JwtService(config);
}

const CLAIMS: AccessTokenClaims = { sub: 'user-1', fam: 'family-1' };

describe('JwtService (HS256 access tokens)', () => {
  it('round-trips claims through sign/verify', () => {
    const jwt = makeJwtService('unit-test-secret-0123456789abcdef0123456789');
    const token = jwt.sign(CLAIMS);
    expect(token.split('.')).toHaveLength(3);
    expect(jwt.verify(token)).toEqual(CLAIMS);
  });

  it('honors a custom TTL and encodes an exp claim', () => {
    const jwt = makeJwtService('unit-test-secret-0123456789abcdef0123456789');
    const token = jwt.sign(CLAIMS, 60);
    const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as {
      exp: number;
      iat: number;
      iss: string;
    };
    expect(payload.exp - payload.iat).toBe(60);
    expect(payload.iss).toBe('arcdrop');
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const jwt = makeJwtService('unit-test-secret-0123456789abcdef0123456789');
    const token = jwt.sign(CLAIMS);
    const [header, , signature] = token.split('.') as [string, string, string];
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'user-2', fam: 'family-2', exp: Math.floor(Date.now() / 1000) + 999 }),
    ).toString('base64url');
    expect(() => jwt.verify(`${header}.${forgedPayload}.${signature}`)).toThrow(
      'Invalid access token',
    );
  });

  it('rejects a token signed with a different secret', () => {
    const signed = makeJwtService('another-secret-0123456789abcdef0123456789abcdef').sign(CLAIMS);
    const verifier = makeJwtService('unit-test-secret-0123456789abcdef0123456789');
    expect(() => verifier.verify(signed)).toThrow('Invalid access token');
  });

  it('pins the algorithm — a forged none/HS512 header is rejected', () => {
    const jwt = makeJwtService('unit-test-secret-0123456789abcdef0123456789');
    const [, payload, signature] = jwt.sign(CLAIMS).split('.') as [string, string, string];
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    expect(() => jwt.verify(`${noneHeader}.${payload}.${signature}`)).toThrow(
      'Unsupported token algorithm',
    );
    const hs512Header = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString(
      'base64url',
    );
    expect(() => jwt.verify(`${hs512Header}.${payload}.${signature}`)).toThrow(
      'Unsupported token algorithm',
    );
  });

  it('rejects malformed tokens and missing claims', () => {
    const jwt = makeJwtService('unit-test-secret-0123456789abcdef0123456789');
    expect(() => jwt.verify('not-a-jwt')).toThrow('Malformed access token');
    expect(() => jwt.verify('a.b')).toThrow('Malformed access token');

    const expired = jwt.sign(CLAIMS, -10);
    expect(() => jwt.verify(expired)).toThrow('Access token expired');

    const noSub = Buffer.from(JSON.stringify({ iss: 'arcdrop', exp: 9e15 })).toString('base64url');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const signature = jwt.sign(CLAIMS).split('.')[2]!;
    expect(() => jwt.verify(`${header}.${noSub}.${signature}`)).toThrow('Invalid access token');
  });
});
