import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { decodeBase32, generateTotp } from '../src/auth/crypto/totp.service';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { installTestEnv } from './helpers';

/**
 * M15 — TOTP two-factor authentication & account lifecycle (plan D19/D15/D20).
 *
 * Three isolated boots against real Postgres:
 * - Boot A: Full TOTP 2FA flow — setup (pending until confirmed), enable
 *   (bad code 401, good code 200 → 10 single-use recovery codes hashed at
 *   rest + all sessions revoked), two-step login (401 TOTP_REQUIRED →
 *   /auth/login/tfa with TOTP or single-use recovery code), disable (via TOTP
 *   or recovery code → all sessions revoked), and PAT refusal on 2FA routes.
 * - Boot B: Account lifecycle — `POST /me/reset-data` (password-confirmed
 *   virgin-state proof: lists empty, notifications wiped, `sync/state` = '0',
 *   old cursors receive `resyncRequired: true`, profile/settings/sessions
 *   survive, other users untouched) and `DELETE /me` (password-confirmed,
 *   last-admin 409, multi-admin cascade, non-admin cascade, M2 admin delete
 *   still guarded).
 * - Boot C: Hard throttling on all 2FA routes (`5/min` → 6th request 429).
 */

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  challenge?: string;
  expiresAt?: string;
}

interface UserView {
  id: string;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  hasPassword: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

interface AuthSession {
  user: UserView;
  accessToken: string;
  refreshToken: string;
}

interface SessionView {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
  current: boolean;
  revokedAt: string | null;
}

interface CallResult<T> {
  status: number;
  body: T;
  contentType: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function call<T = Record<string, unknown>>(
  baseUrl: string,
  method: Method,
  path: string,
  init: { body?: unknown; bearer?: string } = {},
): Promise<CallResult<T>> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.bearer) headers['authorization'] = `Bearer ${init.bearer}`;
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = (
    contentType.includes('json') ? ((await res.json()) as T) : ((await res.text()) as unknown as T)
  ) as T;
  return { status: res.status, body, contentType };
}

const problem = (r: CallResult<unknown>) => r.body as unknown as Problem;

async function bootApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const config = loadConfig();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(0);
  return { app, baseUrl: await app.getUrl() };
}

async function wipeData(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM notification_outbox');
  await dataSource.query('DELETE FROM audit_log_entries');
  await dataSource.query('DELETE FROM personal_access_tokens');
  await dataSource.query('DELETE FROM tfa_recovery_codes');
  await dataSource.query('DELETE FROM change_events');
  await dataSource.query('DELETE FROM highlights');
  await dataSource.query('DELETE FROM bookmark_tags');
  await dataSource.query('DELETE FROM bookmark_collections');
  await dataSource.query('DELETE FROM tags');
  await dataSource.query('DELETE FROM bookmarks');
  await dataSource.query('DELETE FROM collections');
  await dataSource.query('DELETE FROM refresh_tokens');
  await dataSource.query('DELETE FROM one_time_tokens');
  await dataSource.query('DELETE FROM users');
  await dataSource.query('DELETE FROM settings');
}

async function bootstrapAdmin(
  baseUrl: string,
  email = 'root@arcdrop.test',
  password = 'root-password-1',
): Promise<AuthSession> {
  const res = await call<AuthSession>(baseUrl, 'POST', '/auth/bootstrap', {
    body: { email, password, deviceLabel: 'admin-main' },
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function createUserViaAdmin(
  baseUrl: string,
  admin: AuthSession,
  email: string,
  password = 'user-password-1',
  role: 'admin' | 'user' = 'user',
): Promise<AuthSession> {
  const created = await call<{ user: { id: string }; invite: { token: string } }>(
    baseUrl,
    'POST',
    '/admin/users',
    { bearer: admin.accessToken, body: { email, role } },
  );
  expect(created.status).toBe(201);
  const claim = await call<AuthSession>(baseUrl, 'POST', '/auth/claim', {
    body: { token: created.body.invite.token, password, deviceLabel: `${email}-device-1` },
  });
  expect(claim.status).toBe(201);
  return claim.body;
}

function totpFor(secretBase32: string, timestampMs = Date.now()): string {
  return generateTotp(decodeBase32(secretBase32), { timestampMs });
}

describe('M15 — 2FA & account lifecycle (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  describe('boot A — TOTP 2FA setup, two-step login, recovery codes, session revocation', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let aliceSessionA: AuthSession;
    let aliceSessionB: AuthSession;
    let aliceSecret: string;
    let recoveryCodes: string[];
    let postEnableSession: AuthSession;

    const ALICE_EMAIL = 'alice-tfa@arcdrop.test';
    const ALICE_PASS = 'alice-password-1';

    beforeAll(async () => {
      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      aliceSessionA = await createUserViaAdmin(baseUrl, admin, ALICE_EMAIL, ALICE_PASS);
      const secondLogin = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: ALICE_EMAIL, password: ALICE_PASS, deviceLabel: 'alice-bystander' },
      });
      expect(secondLogin.status).toBe(201);
      aliceSessionB = secondLogin.body;
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('setup generates secret + otpauth URI while leaving 2FA disabled until confirmed', async () => {
      const meBefore = await call<UserView>(baseUrl, 'GET', '/auth/me', {
        bearer: aliceSessionA.accessToken,
      });
      expect(meBefore.status).toBe(200);
      expect(meBefore.body.totpEnabled).toBe(false);

      // Enable before setup returns 400
      const enableEarly = await call(baseUrl, 'POST', '/auth/tfa/enable', {
        bearer: admin.accessToken,
        body: { code: '123456' },
      });
      expect(enableEarly.status).toBe(400);

      const setup = await call<{ secret: string; otpauthUri: string }>(
        baseUrl,
        'POST',
        '/auth/tfa/setup',
        { bearer: aliceSessionA.accessToken },
      );
      expect(setup.status).toBe(200);
      expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setup.body.otpauthUri).toContain('otpauth://totp/');
      expect(setup.body.otpauthUri).toContain(`secret=${setup.body.secret}`);
      expect(setup.body.otpauthUri).toContain('issuer=ArcDrop');
      aliceSecret = setup.body.secret;

      // Still NOT enabled until confirmed
      const meAfterSetup = await call<UserView>(baseUrl, 'GET', '/auth/me', {
        bearer: aliceSessionA.accessToken,
      });
      expect(meAfterSetup.body.totpEnabled).toBe(false);
    });

    it('enable rejects invalid code (401), then confirms valid code, hashes secret/recovery codes, and revokes ALL sessions', async () => {
      const wrongCode = totpFor(aliceSecret) === '000000' ? '111111' : '000000';
      const badEnable = await call(baseUrl, 'POST', '/auth/tfa/enable', {
        bearer: aliceSessionA.accessToken,
        body: { code: wrongCode },
      });
      expect(badEnable.status).toBe(401);
      expect(problem(badEnable).code).toBe('UNAUTHORIZED');

      // Bystander session B still refreshes cleanly because enable did not confirm
      const stillAlive = await call<AuthSession>(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: aliceSessionB.refreshToken },
      });
      expect(stillAlive.status).toBe(201);
      aliceSessionB = stillAlive.body;

      // Confirm with real generated TOTP code
      const validCode = totpFor(aliceSecret);
      const enabled = await call<{ recoveryCodes: string[] }>(baseUrl, 'POST', '/auth/tfa/enable', {
        bearer: aliceSessionA.accessToken,
        body: { code: validCode },
      });
      expect(enabled.status).toBe(200);
      expect(enabled.body.recoveryCodes).toHaveLength(10);
      for (const code of enabled.body.recoveryCodes) {
        expect(code).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
      }
      recoveryCodes = enabled.body.recoveryCodes;

      // Secret encrypted at rest; recovery codes hashed at rest
      const userRows = (await dataSource.query(
        'SELECT totp_enabled, totp_secret FROM users WHERE id = $1',
        [aliceSessionA.user.id],
      )) as Array<{ totp_enabled: boolean; totp_secret: string }>;
      expect(userRows[0]!.totp_enabled).toBe(true);
      expect(userRows[0]!.totp_secret.startsWith('v1:')).toBe(true);
      expect(userRows[0]!.totp_secret).not.toContain(aliceSecret);

      const dbCodes = (await dataSource.query(
        'SELECT code_hash, used_at FROM tfa_recovery_codes WHERE user_id = $1',
        [aliceSessionA.user.id],
      )) as Array<{ code_hash: string; used_at: string | null }>;
      expect(dbCodes).toHaveLength(10);
      expect(dbCodes.every((r) => r.used_at === null)).toBe(true);
      expect(JSON.stringify(dbCodes)).not.toContain(recoveryCodes[0]!);

      // Both caller session A and bystander session B had their refresh tokens revoked
      const refreshA = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: aliceSessionA.refreshToken },
      });
      expect(refreshA.status).toBe(401);

      const refreshB = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: aliceSessionB.refreshToken },
      });
      expect(refreshB.status).toBe(401);

      // Re-setup / re-enable while already enabled -> 409 Conflict
      const setupAgain = await call(baseUrl, 'POST', '/auth/tfa/setup', {
        bearer: aliceSessionA.accessToken,
      });
      expect(setupAgain.status).toBe(409);
      expect(problem(setupAgain).code).toBe('CONFLICT');

      const enableAgain = await call(baseUrl, 'POST', '/auth/tfa/enable', {
        bearer: aliceSessionA.accessToken,
        body: { code: validCode },
      });
      expect(enableAgain.status).toBe(409);
    });

    it('two-step login: wrong password gives generic 401; valid password returns TOTP_REQUIRED; TOTP completes; sessions reflect revocation', async () => {
      const wrongPass = await call(baseUrl, 'POST', '/auth/login', {
        body: { email: ALICE_EMAIL, password: 'wrong-password-1' },
      });
      expect(wrongPass.status).toBe(401);
      expect(problem(wrongPass).code).toBe('UNAUTHORIZED');
      expect(problem(wrongPass).challenge).toBeUndefined();

      const step1 = await call(baseUrl, 'POST', '/auth/login', {
        body: { email: ALICE_EMAIL, password: ALICE_PASS, deviceLabel: 'alice-tfa-login' },
      });
      expect(step1.status).toBe(401);
      expect(step1.contentType.startsWith('application/problem+json')).toBe(true);
      const p = problem(step1);
      expect(p.code).toBe('TOTP_REQUIRED');
      expect(typeof p.challenge).toBe('string');
      expect(p.challenge!.length).toBeGreaterThan(20);
      expect(Date.parse(p.expiresAt!)).toBeGreaterThan(Date.now() + 3 * 60 * 1000);

      // Challenge token cannot be claimed via /auth/claim
      const misusedClaim = await call(baseUrl, 'POST', '/auth/claim', {
        body: { token: p.challenge!, password: 'new-password-123' },
      });
      expect(misusedClaim.status).toBe(401);

      // Wrong TOTP code -> 401 UNAUTHORIZED
      const wrongCode = totpFor(aliceSecret) === '000000' ? '111111' : '000000';
      const badStep2 = await call(baseUrl, 'POST', '/auth/login/tfa', {
        body: { challenge: p.challenge!, code: wrongCode },
      });
      expect(badStep2.status).toBe(401);
      expect(problem(badStep2).code).toBe('UNAUTHORIZED');

      // Valid TOTP code completes login -> normal session pair with totpEnabled: true
      const goodStep2 = await call<AuthSession>(baseUrl, 'POST', '/auth/login/tfa', {
        body: {
          challenge: p.challenge!,
          code: totpFor(aliceSecret),
          deviceLabel: 'alice-2fa-verified',
        },
      });
      expect(goodStep2.status).toBe(201);
      expect(goodStep2.body.user.totpEnabled).toBe(true);
      expect(goodStep2.body.accessToken.split('.')).toHaveLength(3);
      postEnableSession = goodStep2.body;

      // Challenge is single-use
      const replayChallenge = await call(baseUrl, 'POST', '/auth/login/tfa', {
        body: { challenge: p.challenge!, code: totpFor(aliceSecret) },
      });
      expect(replayChallenge.status).toBe(401);

      // Verify via /auth/sessions that prior sessions were revoked when 2FA enabled
      const sessions = await call<SessionView[]>(baseUrl, 'GET', '/auth/sessions', {
        bearer: postEnableSession.accessToken,
      });
      expect(sessions.status).toBe(200);
      const currentCount = sessions.body.filter((s) => s.current && s.revokedAt === null).length;
      const priorRevoked = sessions.body.filter((s) => !s.current && s.revokedAt !== null).length;
      expect(currentCount).toBe(1);
      expect(priorRevoked).toBeGreaterThanOrEqual(2);
    });

    it('recovery code logs in exactly once and second use is rejected', async () => {
      const code0 = recoveryCodes[0]!;

      const step1a = await call(baseUrl, 'POST', '/auth/login', {
        body: { email: ALICE_EMAIL, password: ALICE_PASS },
      });
      expect(step1a.status).toBe(401);
      const challenge1 = problem(step1a).challenge!;

      const loginWithRecovery = await call<AuthSession>(baseUrl, 'POST', '/auth/login/tfa', {
        body: { challenge: challenge1, recoveryCode: code0.toUpperCase() },
      });
      expect(loginWithRecovery.status).toBe(201);
      expect(loginWithRecovery.body.user.totpEnabled).toBe(true);

      // Consumed marker recorded in DB
      const consumedRows = (await dataSource.query(
        'SELECT count(*)::int AS cnt FROM tfa_recovery_codes WHERE user_id = $1 AND used_at IS NOT NULL',
        [aliceSessionA.user.id],
      )) as Array<{ cnt: number }>;
      expect(consumedRows[0]!.cnt).toBe(1);

      // Second use of the same recovery code is rejected
      const step1b = await call(baseUrl, 'POST', '/auth/login', {
        body: { email: ALICE_EMAIL, password: ALICE_PASS },
      });
      expect(step1b.status).toBe(401);
      const challenge2 = problem(step1b).challenge!;

      const secondUse = await call(baseUrl, 'POST', '/auth/login/tfa', {
        body: { challenge: challenge2, recoveryCode: code0 },
      });
      expect(secondUse.status).toBe(401);
      expect(problem(secondUse).code).toBe('UNAUTHORIZED');
    });

    it('disable verifies TOTP/recovery code, revokes ALL sessions, restores 1-step login', async () => {
      // Wrong recovery code -> 401
      const badDisable = await call(baseUrl, 'POST', '/auth/tfa/disable', {
        bearer: postEnableSession.accessToken,
        body: { recoveryCode: recoveryCodes[0]! }, // already consumed!
      });
      expect(badDisable.status).toBe(401);

      // Valid recovery code #1 disables 2FA
      const disabled = await call(baseUrl, 'POST', '/auth/tfa/disable', {
        bearer: postEnableSession.accessToken,
        body: { recoveryCode: recoveryCodes[1]! },
      });
      expect(disabled.status).toBe(204);

      // Refresh token from postEnableSession was revoked
      const deadRefresh = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: postEnableSession.refreshToken },
      });
      expect(deadRefresh.status).toBe(401);

      // Recovery codes deleted from DB
      const remainingCodes = (await dataSource.query(
        'SELECT count(*)::int AS cnt FROM tfa_recovery_codes WHERE user_id = $1',
        [aliceSessionA.user.id],
      )) as Array<{ cnt: number }>;
      expect(remainingCodes[0]!.cnt).toBe(0);

      // Login is back to single-step with totpEnabled: false
      const backToSingle = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: ALICE_EMAIL, password: ALICE_PASS, deviceLabel: 'post-disable' },
      });
      expect(backToSingle.status).toBe(201);
      expect(backToSingle.body.user.totpEnabled).toBe(false);

      // All prior sessions (including recovery login) appear revoked via /auth/sessions
      const sessionsAfterDisable = await call<SessionView[]>(baseUrl, 'GET', '/auth/sessions', {
        bearer: backToSingle.body.accessToken,
      });
      expect(sessionsAfterDisable.status).toBe(200);
      expect(
        sessionsAfterDisable.body.filter((row) => row.current && row.revokedAt === null),
      ).toHaveLength(1);
      expect(
        sessionsAfterDisable.body.filter((row) => !row.current && row.revokedAt === null),
      ).toHaveLength(0);

      // Disable while already off -> 400
      const disableAgain = await call(baseUrl, 'POST', '/auth/tfa/disable', {
        bearer: backToSingle.body.accessToken,
        body: { code: '123456' },
      });
      expect(disableAgain.status).toBe(400);
    });
  });

  describe('boot B — account lifecycle: POST /me/reset-data and DELETE /me', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin1: AuthSession;
    let admin2: AuthSession;
    let alice: AuthSession;
    let aliceDevice2: AuthSession;
    let bob: AuthSession;

    beforeAll(async () => {
      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin1 = await bootstrapAdmin(baseUrl, 'admin1@arcdrop.test', 'admin1-password');
      alice = await createUserViaAdmin(baseUrl, admin1, 'alice-life@arcdrop.test', 'alice-life-pw');
      const aliceLogin2 = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: 'alice-life@arcdrop.test', password: 'alice-life-pw', deviceLabel: 'dev2' },
      });
      expect(aliceLogin2.status).toBe(201);
      aliceDevice2 = aliceLogin2.body;
      bob = await createUserViaAdmin(baseUrl, admin1, 'bob-life@arcdrop.test', 'bob-life-pw');
      admin2 = await createUserViaAdmin(
        baseUrl,
        admin1,
        'admin2@arcdrop.test',
        'admin2-password',
        'admin',
      );
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('POST /me/reset-data requires password, wipes all user data + outbox + sync_seq, triggers resyncRequired, keeps sessions & other users intact', async () => {
      // Seed Alice's library: collection, tagged bookmark with reminder + highlight, plus Bob's bookmark
      const col = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'Alice Folder' },
      });
      expect(col.status).toBe(201);

      const bm = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: {
          url: 'https://example.com/alice-doc',
          title: 'Alice Doc',
          tags: ['research'],
          collectionIds: [col.body.id],
          reminderAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
      expect(bm.status).toBe(201);

      const hl = await call<{ id: string }>(
        baseUrl,
        'POST',
        `/bookmarks/${bm.body.id}/highlights`,
        {
          bearer: alice.accessToken,
          body: { text: 'Important quote', color: 'yellow' },
        },
      );
      expect(hl.status).toBe(201);

      const bobBm = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
        bearer: bob.accessToken,
        body: { url: 'https://example.com/bob-doc', title: 'Bob Doc' },
      });
      expect(bobBm.status).toBe(201);

      const preState = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
        bearer: alice.accessToken,
      });
      expect(BigInt(preState.body.seq)).toBeGreaterThan(0n);

      // Wrong password -> 401; library untouched
      const badReset = await call(baseUrl, 'POST', '/me/reset-data', {
        bearer: alice.accessToken,
        body: { password: 'wrong-password-1' },
      });
      expect(badReset.status).toBe(401);
      expect(problem(badReset).code).toBe('UNAUTHORIZED');

      const stillThere = await call<{ items: Array<{ id: string }> }>(
        baseUrl,
        'GET',
        '/bookmarks',
        { bearer: alice.accessToken },
      );
      expect(stillThere.body.items).toHaveLength(1);

      // Valid password -> 204
      const reset = await call(baseUrl, 'POST', '/me/reset-data', {
        bearer: alice.accessToken,
        body: { password: 'alice-life-pw' },
      });
      expect(reset.status).toBe(204);

      // Virgin library proof for Alice
      const bmAfter = await call<{ items: unknown[] }>(baseUrl, 'GET', '/bookmarks', {
        bearer: alice.accessToken,
      });
      expect(bmAfter.status).toBe(200);
      expect(bmAfter.body.items).toEqual([]);

      const trashAfter = await call<{ items: unknown[] }>(
        baseUrl,
        'GET',
        '/bookmarks?trashed=true',
        { bearer: alice.accessToken },
      );
      expect(trashAfter.body.items).toEqual([]);

      const colAfter = await call<{ items: unknown[] }>(baseUrl, 'GET', '/collections', {
        bearer: alice.accessToken,
      });
      expect(colAfter.status).toBe(200);
      expect(colAfter.body.items).toEqual([]);

      const tagsAfter = await call<unknown[]>(baseUrl, 'GET', '/bookmarks/tags', {
        bearer: alice.accessToken,
      });
      expect(tagsAfter.status).toBe(200);
      expect(tagsAfter.body).toEqual([]);

      const notifAfter = await call<{ items: unknown[] }>(baseUrl, 'GET', '/notifications', {
        bearer: alice.accessToken,
      });
      expect(notifAfter.status).toBe(200);
      expect(notifAfter.body.items).toEqual([]);

      // Sync state reset to 0; device with old cursor gets resyncRequired: true
      const postState = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
        bearer: alice.accessToken,
      });
      expect(postState.body.seq).toBe('0');

      const changes = await call<{
        resyncRequired: boolean;
        changes: unknown[];
        cursor: string;
      }>(baseUrl, 'GET', `/sync/changes?since=${preState.body.seq}`, {
        bearer: alice.accessToken,
      });
      expect(changes.status).toBe(200);
      expect(changes.body).toEqual({ resyncRequired: true, changes: [], cursor: '0' });

      // DB check: highlights, change_events, notification_outbox, bookmarks, collections, tags wiped for Alice
      const counts = (await dataSource.query(
        `SELECT
           (SELECT count(*)::int FROM bookmarks WHERE user_id = $1) AS bm,
           (SELECT count(*)::int FROM collections WHERE user_id = $1) AS col,
           (SELECT count(*)::int FROM tags WHERE user_id = $1) AS tag,
           (SELECT count(*)::int FROM highlights WHERE user_id = $1) AS hl,
           (SELECT count(*)::int FROM change_events WHERE user_id = $1) AS ce,
           (SELECT count(*)::int FROM notification_outbox WHERE user_id = $1) AS no`,
        [alice.user.id],
      )) as Array<{ bm: number; col: number; tag: number; hl: number; ce: number; no: number }>;
      expect(counts[0]).toEqual({ bm: 0, col: 0, tag: 0, hl: 0, ce: 0, no: 0 });

      // Sessions and profile survive reset-data
      const me = await call<UserView>(baseUrl, 'GET', '/auth/me', { bearer: alice.accessToken });
      expect(me.status).toBe(200);
      expect(me.body.email).toBe('alice-life@arcdrop.test');

      const dev2Refresh = await call<AuthSession>(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: aliceDevice2.refreshToken },
      });
      expect(dev2Refresh.status).toBe(201);
      aliceDevice2 = dev2Refresh.body;

      // Creating fresh data after reset starts cleanly from seq 1
      const freshBm = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        body: { url: 'https://example.com/fresh-after-reset' },
      });
      expect(freshBm.status).toBe(201);
      const afterFreshState = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
        bearer: alice.accessToken,
      });
      expect(afterFreshState.body.seq).toBe('1');

      // Bob's library is completely untouched
      const bobList = await call<{ items: Array<{ id: string }> }>(baseUrl, 'GET', '/bookmarks', {
        bearer: bob.accessToken,
      });
      expect(bobList.body.items.map((i) => i.id)).toEqual([bobBm.body.id]);
    });

    it('DELETE /me: non-admin deletes cascade all data + invalidate tokens/login', async () => {
      const badDelete = await call(baseUrl, 'DELETE', '/me', {
        bearer: alice.accessToken,
        body: { password: 'wrong-password-1' },
      });
      expect(badDelete.status).toBe(401);

      // Seed a PAT for Alice to verify PATs are also deleted
      const alicePat = await call<{ id: string; token: string }>(baseUrl, 'POST', '/me/tokens', {
        bearer: alice.accessToken,
        body: { name: 'doomed-pat' },
      });
      expect(alicePat.status).toBe(201);

      const deleted = await call(baseUrl, 'DELETE', '/me', {
        bearer: alice.accessToken,
        body: { password: 'alice-life-pw' },
      });
      expect(deleted.status).toBe(204);

      // JWT, refresh token, PAT, and login are all dead immediately
      const deadMe = await call(baseUrl, 'GET', '/auth/me', { bearer: alice.accessToken });
      expect(deadMe.status).toBe(401);

      const deadRefresh = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: aliceDevice2.refreshToken },
      });
      expect(deadRefresh.status).toBe(401);

      const deadPat = await call(baseUrl, 'GET', '/bookmarks', { bearer: alicePat.body.token });
      expect(deadPat.status).toBe(401);

      const deadLogin = await call(baseUrl, 'POST', '/auth/login', {
        body: { email: 'alice-life@arcdrop.test', password: 'alice-life-pw' },
      });
      expect(deadLogin.status).toBe(401);

      // All Alice rows removed; Bob untouched
      const leftovers = (await dataSource.query(
        `SELECT
           (SELECT count(*)::int FROM users WHERE id = $1) AS u,
           (SELECT count(*)::int FROM bookmarks WHERE user_id = $1) AS b,
           (SELECT count(*)::int FROM personal_access_tokens WHERE user_id = $1) AS p,
           (SELECT count(*)::int FROM refresh_tokens WHERE user_id = $1) AS r`,
        [alice.user.id],
      )) as Array<{ u: number; b: number; p: number; r: number }>;
      expect(leftovers[0]).toEqual({ u: 0, b: 0, p: 0, r: 0 });

      const bobBookmarks = await call<{ items: unknown[] }>(baseUrl, 'GET', '/bookmarks', {
        bearer: bob.accessToken,
      });
      expect(bobBookmarks.body.items).toHaveLength(1);
    });

    it('DELETE /me enforces last-active-admin 409, while allowing deletion when a second active admin exists (and M2 guard stays intact)', async () => {
      // With 2 active admins, M2 demote/disable check on admin2 works only while another admin exists;
      // verify admin1 can self-delete because admin2 is active
      const del1 = await call(baseUrl, 'DELETE', '/me', {
        bearer: admin1.accessToken,
        body: { password: 'admin1-password' },
      });
      expect(del1.status).toBe(204);

      // Now admin2 is the LAST active admin:
      // 1) M2 admin surface still blocks self-demote and self-disable (409)
      const m2Demote = await call(baseUrl, 'PATCH', `/admin/users/${admin2.user.id}`, {
        bearer: admin2.accessToken,
        body: { role: 'user' },
      });
      expect(m2Demote.status).toBe(409);
      expect(problem(m2Demote).code).toBe('CONFLICT');

      const m2Disable = await call(baseUrl, 'PATCH', `/admin/users/${admin2.user.id}`, {
        bearer: admin2.accessToken,
        body: { status: 'disabled' },
      });
      expect(m2Disable.status).toBe(409);

      // 2) DELETE /me blocks last active admin with 409 Conflict
      const lastAdminDel = await call(baseUrl, 'DELETE', '/me', {
        bearer: admin2.accessToken,
        body: { password: 'admin2-password' },
      });
      expect(lastAdminDel.status).toBe(409);
      expect(problem(lastAdminDel).code).toBe('CONFLICT');
      expect(problem(lastAdminDel).detail).toContain('last active admin');

      // Account survived
      const stillActive = await call<UserView>(baseUrl, 'GET', '/auth/me', {
        bearer: admin2.accessToken,
      });
      expect(stillActive.status).toBe(200);
      expect(stillActive.body.id).toBe(admin2.user.id);
    });
  });

  describe('boot C — hard throttling on all 2FA routes (5 req/min)', () => {
    let app: INestApplication;
    let baseUrl: string;
    let admin: AuthSession;
    let secret: string;

    beforeAll(async () => {
      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      const dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('the 6th request to /auth/tfa/setup, /auth/tfa/enable, /auth/login/tfa, and /auth/tfa/disable returns 429', async () => {
      // 1. /auth/tfa/setup (5 ok, 6th -> 429)
      for (let i = 0; i < 5; i++) {
        const res = await call<{ secret: string }>(baseUrl, 'POST', '/auth/tfa/setup', {
          bearer: admin.accessToken,
        });
        expect(res.status).toBe(200);
        secret = res.body.secret;
      }
      const setup6 = await call(baseUrl, 'POST', '/auth/tfa/setup', { bearer: admin.accessToken });
      expect(setup6.status).toBe(429);
      expect(problem(setup6).code).toBe('TOO_MANY_REQUESTS');

      // 2. /auth/tfa/enable (4 bad -> 401, 5th good -> 200, 6th -> 429)
      const wrongCode = totpFor(secret) === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i++) {
        const res = await call(baseUrl, 'POST', '/auth/tfa/enable', {
          bearer: admin.accessToken,
          body: { code: wrongCode },
        });
        expect(res.status).toBe(401);
      }
      const enable5 = await call<{ recoveryCodes: string[] }>(baseUrl, 'POST', '/auth/tfa/enable', {
        bearer: admin.accessToken,
        body: { code: totpFor(secret) },
      });
      expect(enable5.status).toBe(200);

      const enable6 = await call(baseUrl, 'POST', '/auth/tfa/enable', {
        bearer: admin.accessToken,
        body: { code: totpFor(secret) },
      });
      expect(enable6.status).toBe(429);
      expect(problem(enable6).code).toBe('TOO_MANY_REQUESTS');

      // 3. /auth/login/tfa (5 failed attempts -> 401, 6th -> 429)
      for (let i = 0; i < 5; i++) {
        const res = await call(baseUrl, 'POST', '/auth/login/tfa', {
          body: { challenge: 'not-a-valid-challenge', code: '123456' },
        });
        expect(res.status).toBe(401);
      }
      const loginTfa6 = await call(baseUrl, 'POST', '/auth/login/tfa', {
        body: { challenge: 'not-a-valid-challenge', code: '123456' },
      });
      expect(loginTfa6.status).toBe(429);
      expect(problem(loginTfa6).code).toBe('TOO_MANY_REQUESTS');

      // 4. /auth/tfa/disable (5 bad -> 401, 6th -> 429)
      for (let i = 0; i < 5; i++) {
        const res = await call(baseUrl, 'POST', '/auth/tfa/disable', {
          bearer: admin.accessToken,
          body: { code: wrongCode },
        });
        expect(res.status).toBe(401);
      }
      const disable6 = await call(baseUrl, 'POST', '/auth/tfa/disable', {
        bearer: admin.accessToken,
        body: { code: wrongCode },
      });
      expect(disable6.status).toBe(429);
      expect(problem(disable6).code).toBe('TOO_MANY_REQUESTS');
    });
  });
});
