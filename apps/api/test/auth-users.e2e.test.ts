import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { createDataSource } from '../src/database/data-source';
import { loadConfig } from '../src/config/load-config';
import { installTestEnv } from './helpers';

/**
 * M2 auth & users e2e (plan D2/D3/D15/D16) — real HTTP against real
 * Postgres. One boot drives the whole lifecycle (bootstrap → login → me →
 * refresh → reuse-revocation → password change → sessions → invite/reset →
 * registration gate → disable), a second fresh boot exercises the throttler
 * in isolation so the strict `/auth/*` budget is never polluted by earlier
 * flows.
 */

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance?: string;
  requestId?: string;
  errors?: Array<{ field: string; messages: string[] }>;
}

interface UserView {
  id: string;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  hasPassword: boolean;
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

interface SettingsView {
  registrationOpen: boolean;
  trashRetentionDays: number;
  changeLogRetentionDays: number;
  brokenLinkCheckMode: 'off' | 'basic' | 'default' | 'strict';
  archiveMaxBytes: number;
}

interface CallResult<T> {
  status: number;
  body: T;
  contentType: string;
}

async function call<T = Record<string, unknown>>(
  baseUrl: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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

function decodeJwtPayload(token: string): { sub: string; fam: string } {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as {
    sub: string;
    fam: string;
  };
}

async function bootApp(): Promise<{
  app: INestApplication;
  baseUrl: string;
  document: OpenAPIObject;
}> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const config = loadConfig();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(0);
  return { app, baseUrl: await app.getUrl(), document };
}

const ADMIN_EMAIL = 'root@arcdrop.test';
const ADMIN_PASSWORD = 'root-password-1';
const USER_PASSWORD = 'user-password-1';
const USER_PASSWORD_2 = 'user-password-2';

describe('Auth & users (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    // Idempotent: makes this file order-independent vs. the foundation suite.
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  describe('main boot — full lifecycle', () => {
    let app: INestApplication;
    let baseUrl: string;

    let admin: AuthSession; // bootstrap session (family B — dies in reuse test)
    let adminRotated: AuthSession; // rotation test (family A — dies in reuse test)
    let preRotationRefresh: string; // the token rotated away in the refresh test
    let adminG: AuthSession; // survives as the working admin bearer
    let alice: AuthSession; // invite-claimed user, reused across admin-surface tests

    beforeAll(async () => {
      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      // Deterministic start: wipe auth state (order respects FKs).
      const dataSource = app.get(DataSource);
      await dataSource.query('DELETE FROM refresh_tokens');
      await dataSource.query('DELETE FROM one_time_tokens');
      await dataSource.query('DELETE FROM users');
      await dataSource.query('DELETE FROM settings');
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('bootstrap creates the first admin and issues a token pair', async () => {
      const r = await call<AuthSession>(baseUrl, 'POST', '/auth/bootstrap', {
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, deviceLabel: 'bootstrap' },
      });
      expect(r.status).toBe(201);
      const session = r.body;
      expect(session.user.email).toBe(ADMIN_EMAIL);
      expect(session.user.role).toBe('admin');
      expect(session.user.status).toBe('active');
      expect(session.user.hasPassword).toBe(true);
      expect(session.accessToken.split('.')).toHaveLength(3);
      expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      admin = session;
    });

    it('a second bootstrap is refused with a 409 problem', async () => {
      const r = await call(baseUrl, 'POST', '/auth/bootstrap', {
        body: { email: 'other@arcdrop.test', password: 'whatever-password' },
      });
      expect(r.status).toBe(409);
      expect(r.contentType.startsWith('application/problem+json')).toBe(true);
      const p = problem(r);
      expect(p.code).toBe('CONFLICT');
      expect(p.status).toBe(409);
      expect(typeof p.requestId).toBe('string');
    });

    it('settings start at their documented defaults (D16)', async () => {
      const r = await call<SettingsView>(baseUrl, 'GET', '/admin/settings', {
        bearer: admin.accessToken,
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        registrationOpen: false,
        trashRetentionDays: 30,
        changeLogRetentionDays: 90,
        brokenLinkCheckMode: 'default',
        archiveMaxBytes: 70 * 1024 * 1024,
      });
    });

    it('settings PUT validates ranges (400 problem with field details)', async () => {
      const r = await call<Problem>(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { trashRetentionDays: 0 },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('VALIDATION_FAILED');
      expect(r.body.errors?.map((e) => e.field)).toContain('trashRetentionDays');
    });

    it('login works; response carries tokens and the user', async () => {
      const r = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: ADMIN_EMAIL.toUpperCase(), password: ADMIN_PASSWORD, deviceLabel: 'main' },
      });
      expect(r.status).toBe(201);
      expect(r.body.user.email).toBe(ADMIN_EMAIL); // normalized
      expect(r.body.refreshToken).not.toBe(admin.refreshToken);
      adminRotated = r.body;
    });

    it('/auth/me requires a bearer token (401 problem+json)', async () => {
      const missing = await call(baseUrl, 'GET', '/auth/me');
      expect(missing.status).toBe(401);
      expect(missing.contentType.startsWith('application/problem+json')).toBe(true);
      expect(problem(missing).code).toBe('UNAUTHORIZED');

      const garbage = await call(baseUrl, 'GET', '/auth/me', {
        bearer: 'not-a-real-token',
      });
      expect(garbage.status).toBe(401);
      expect(problem(garbage).code).toBe('UNAUTHORIZED');
    });

    it('/auth/me with a valid bearer returns the caller', async () => {
      const r = await call<UserView>(baseUrl, 'GET', '/auth/me', {
        bearer: adminRotated.accessToken,
      });
      expect(r.status).toBe(200);
      expect(r.body.email).toBe(ADMIN_EMAIL);
      expect(r.body.role).toBe('admin');
      expect(r.body.hasPassword).toBe(true);
    });

    it('refresh rotates the token inside the same family', async () => {
      const oldFam = decodeJwtPayload(adminRotated.accessToken).fam;
      preRotationRefresh = adminRotated.refreshToken;
      const r = await call<AuthSession>(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: adminRotated.refreshToken },
      });
      expect(r.status).toBe(201);
      expect(decodeJwtPayload(r.body.accessToken).fam).toBe(oldFam);
      expect(r.body.refreshToken).not.toBe(adminRotated.refreshToken);
      adminRotated = r.body;
    });

    it('replaying the rotated token revokes the family (D2) — visible in sessions', async () => {
      const fam = decodeJwtPayload(adminRotated.accessToken).fam;

      const replay = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: preRotationRefresh },
      });
      expect(replay.status).toBe(401);
      expect(problem(replay).code).toBe('UNAUTHORIZED');
      expect(problem(replay).detail).toContain('reuse');

      // The whole family is dead — even the legitimate latest token.
      const current = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: adminRotated.refreshToken },
      });
      expect(current.status).toBe(401);

      // …and the revocation is observable in the session list.
      const sessions = await call<SessionView[]>(baseUrl, 'GET', '/auth/sessions', {
        bearer: adminRotated.accessToken,
      });
      expect(sessions.status).toBe(200);
      const revokedFamily = sessions.body.find((s) => s.id === fam);
      expect(revokedFamily).toBeDefined();
      expect(revokedFamily!.revokedAt).not.toBeNull();
    });

    it('password change revokes other sessions but keeps the caller logged in', async () => {
      // Two fresh sessions: the changer (G) and a bystander device (H).
      const g = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, deviceLabel: 'device-G' },
      });
      expect(g.status).toBe(201);
      const h = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, deviceLabel: 'device-H' },
      });
      expect(h.status).toBe(201);
      adminG = g.body;

      const change = await call(baseUrl, 'POST', '/auth/password', {
        bearer: adminG.accessToken,
        body: { currentPassword: ADMIN_PASSWORD, newPassword: 'root-password-2' },
      });
      expect(change.status).toBe(204);

      // The bystander device was logged out everywhere…
      const dead = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: h.body.refreshToken },
      });
      expect(dead.status).toBe(401);

      // …while the changer's own session survived.
      const survivor = await call<AuthSession>(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: adminG.refreshToken },
      });
      expect(survivor.status).toBe(201);
      adminG = survivor.body;
    });

    it('after the change the old password is dead and the new one logs in', async () => {
      const oldPassword = await call(baseUrl, 'POST', '/auth/login', {
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });
      expect(oldPassword.status).toBe(401);

      const newPassword = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: ADMIN_EMAIL, password: 'root-password-2', deviceLabel: 'post-change' },
      });
      expect(newPassword.status).toBe(201);
    });

    it('logout revokes the presented refresh token and is idempotent', async () => {
      // Grab a disposable session to log out of.
      const disposable = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: ADMIN_EMAIL, password: 'root-password-2', deviceLabel: 'logout-me' },
      });
      expect(disposable.status).toBe(201);

      const first = await call(baseUrl, 'POST', '/auth/logout', {
        body: { refreshToken: disposable.body.refreshToken },
      });
      expect(first.status).toBe(204);

      const again = await call(baseUrl, 'POST', '/auth/logout', {
        body: { refreshToken: disposable.body.refreshToken },
      });
      expect(again.status).toBe(204);

      const dead = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: disposable.body.refreshToken },
      });
      expect(dead.status).toBe(401);
    });

    it('sessions listing marks the current session; revocation kills a family', async () => {
      const extra = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: ADMIN_EMAIL, password: 'root-password-2', deviceLabel: 'revoke-me' },
      });
      expect(extra.status).toBe(201);
      const extraFam = decodeJwtPayload(extra.body.accessToken).fam;

      const listed = await call<SessionView[]>(baseUrl, 'GET', '/auth/sessions', {
        bearer: adminG.accessToken,
      });
      expect(listed.status).toBe(200);
      const ownFamily = decodeJwtPayload(adminG.accessToken).fam;
      const byId = new Map(listed.body.map((s) => [s.id, s]));
      expect(byId.get(ownFamily)?.current).toBe(true);
      expect(byId.get(extraFam)?.current).toBe(false);
      expect(byId.get(extraFam)?.deviceLabel).toBe('revoke-me');
      expect(byId.get(extraFam)?.revokedAt).toBeNull();

      const revoke = await call(baseUrl, 'DELETE', `/auth/sessions/${extraFam}`, {
        bearer: adminG.accessToken,
      });
      expect(revoke.status).toBe(204);

      const dead = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: extra.body.refreshToken },
      });
      expect(dead.status).toBe(401);

      // A malformed session id is a validation error, not a 500.
      const malformed = await call(baseUrl, 'DELETE', '/auth/sessions/not-a-uuid', {
        bearer: adminG.accessToken,
      });
      expect(malformed.status).toBe(400);
      expect(problem(malformed).code).toBe('VALIDATION_FAILED');
    });

    it('admin creates a user and the invite token claims + logs in (D15)', async () => {
      const created = await call<{
        user: UserView;
        invite: { token: string; expiresAt: string };
      }>(baseUrl, 'POST', '/admin/users', {
        bearer: adminG.accessToken,
        body: { email: 'Alice@ArcDrop.test' },
      });
      expect(created.status).toBe(201);
      expect(created.body.user.email).toBe('alice@arcdrop.test');
      expect(created.body.user.hasPassword).toBe(false); // invite pending
      expect(created.body.user.role).toBe('user');
      const inviteAt = Date.parse(created.body.invite.expiresAt);
      expect(inviteAt).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000); // ~24h
      expect(inviteAt).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);

      const duplicate = await call(baseUrl, 'POST', '/admin/users', {
        bearer: adminG.accessToken,
        body: { email: 'alice@arcdrop.test' },
      });
      expect(duplicate.status).toBe(409);
      expect(problem(duplicate).code).toBe('CONFLICT');

      // An unknown token never claims anything.
      const bogus = await call(baseUrl, 'POST', '/auth/claim', {
        body: { token: 'definitely-not-a-token', password: USER_PASSWORD },
      });
      expect(bogus.status).toBe(401);

      const claim = await call<AuthSession>(baseUrl, 'POST', '/auth/claim', {
        body: { token: created.body.invite.token, password: USER_PASSWORD, deviceLabel: 'alice' },
      });
      expect(claim.status).toBe(201);
      expect(claim.body.user.hasPassword).toBe(true);

      const login = await call<AuthSession>(baseUrl, 'POST', '/auth/login', {
        body: { email: 'alice@arcdrop.test', password: USER_PASSWORD },
      });
      expect(login.status).toBe(201);
      alice = login.body;

      // The invite token was single-use.
      const replay = await call(baseUrl, 'POST', '/auth/claim', {
        body: { token: created.body.invite.token, password: 'another-password-1' },
      });
      expect(replay.status).toBe(410);
      expect(problem(replay).code).toBe('GONE');
    });

    it('a non-admin is 403 on the whole admin surface', async () => {
      const bearer = alice.accessToken;

      const users = await call(baseUrl, 'GET', '/admin/users', { bearer });
      expect(users.status).toBe(403);
      expect(problem(users).code).toBe('FORBIDDEN');

      const settings = await call(baseUrl, 'GET', '/admin/settings', { bearer });
      expect(settings.status).toBe(403);
      expect(problem(settings).code).toBe('FORBIDDEN');

      const create = await call(baseUrl, 'POST', '/admin/users', {
        bearer,
        body: { email: 'sneaky@arcdrop.test' },
      });
      expect(create.status).toBe(403);
    });

    it('an expired invite/reset token is rejected (single-use AND expiring)', async () => {
      const created = await call<{ user: UserView }>(baseUrl, 'POST', '/admin/users', {
        bearer: adminG.accessToken,
        body: { email: 'carol@arcdrop.test' },
      });
      expect(created.status).toBe(201);

      // Mint a real token, then age it past its expiry directly in the
      // database — no waiting for the TTL.
      const dataSource = app.get(DataSource);
      const reset = await call<{ reset: { token: string } }>(
        baseUrl,
        'POST',
        `/admin/users/${created.body.user.id}/reset-password`,
        { bearer: adminG.accessToken },
      );
      expect(reset.status).toBe(200);
      await dataSource.query(
        "UPDATE one_time_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
        [created.body.user.id],
      );
      const expired = await call(baseUrl, 'POST', '/auth/claim', {
        body: { token: reset.body.reset.token, password: USER_PASSWORD },
      });
      expect(expired.status).toBe(410);
      expect(problem(expired).code).toBe('GONE');
    });

    it('password reset: admin mints a token, claim replaces the password', async () => {
      const users = await call<UserView[]>(baseUrl, 'GET', '/admin/users', {
        bearer: adminG.accessToken,
      });
      const alice = users.body.find((u) => u.email === 'alice@arcdrop.test');
      expect(alice).toBeDefined();

      const reset = await call<{ reset: { token: string; expiresAt: string } }>(
        baseUrl,
        'POST',
        `/admin/users/${alice!.id}/reset-password`,
        { bearer: adminG.accessToken },
      );
      expect(reset.status).toBe(200);
      const resetAt = Date.parse(reset.body.reset.expiresAt);
      expect(resetAt).toBeGreaterThan(Date.now() + 55 * 60 * 1000); // ~1h
      expect(resetAt).toBeLessThan(Date.now() + 65 * 60 * 1000);

      const claim = await call<AuthSession>(baseUrl, 'POST', '/auth/claim', {
        body: { token: reset.body.reset.token, password: USER_PASSWORD_2 },
      });
      expect(claim.status).toBe(201);

      // Claimed reset tokens cannot be replayed either.
      const replay = await call(baseUrl, 'POST', '/auth/claim', {
        body: { token: reset.body.reset.token, password: 'yet-another-pass-1' },
      });
      expect(replay.status).toBe(410);

      // The new session works; the invite-era password does not.
      const me = await call<UserView>(baseUrl, 'GET', '/auth/me', {
        bearer: claim.body.accessToken,
      });
      expect(me.status).toBe(200);
      const oldPassword = await call(baseUrl, 'POST', '/auth/login', {
        body: { email: 'alice@arcdrop.test', password: USER_PASSWORD },
      });
      expect(oldPassword.status).toBe(401);
    });

    it('registration is 403 while closed and flips live via settings (D3/D16)', async () => {
      const closed = await call(baseUrl, 'POST', '/auth/register', {
        body: { email: 'dave@arcdrop.test', password: USER_PASSWORD },
      });
      expect(closed.status).toBe(403);
      expect(closed.contentType.startsWith('application/problem+json')).toBe(true);
      expect(problem(closed).code).toBe('FORBIDDEN');

      const flipped = await call<SettingsView>(baseUrl, 'PUT', '/admin/settings', {
        bearer: adminG.accessToken,
        body: { registrationOpen: true },
      });
      expect(flipped.status).toBe(200);
      expect(flipped.body.registrationOpen).toBe(true);

      const open = await call<AuthSession>(baseUrl, 'POST', '/auth/register', {
        body: { email: 'dave@arcdrop.test', password: USER_PASSWORD },
      });
      expect(open.status).toBe(201);
      expect(open.body.user.role).toBe('user');

      // No restart needed: flip back and registration closes immediately.
      const flippedBack = await call<SettingsView>(baseUrl, 'PUT', '/admin/settings', {
        bearer: adminG.accessToken,
        body: { registrationOpen: false },
      });
      expect(flippedBack.body.registrationOpen).toBe(false);

      const closedAgain = await call(baseUrl, 'POST', '/auth/register', {
        body: { email: 'eve@arcdrop.test', password: USER_PASSWORD },
      });
      expect(closedAgain.status).toBe(403);
    });

    it("disabled users' tokens stop working immediately; re-enabling restores", async () => {
      const created = await call<{ user: UserView; invite: { token: string } }>(
        baseUrl,
        'POST',
        '/admin/users',
        { bearer: adminG.accessToken, body: { email: 'bob@arcdrop.test' } },
      );
      expect(created.status).toBe(201);
      const bobId = created.body.user.id;

      const claim = await call<AuthSession>(baseUrl, 'POST', '/auth/claim', {
        body: { token: created.body.invite.token, password: USER_PASSWORD },
      });
      expect(claim.status).toBe(201);
      const bobBearer = claim.body.accessToken;

      const alive = await call<UserView>(baseUrl, 'GET', '/auth/me', { bearer: bobBearer });
      expect(alive.status).toBe(200);

      const disable = await call<UserView>(baseUrl, 'PATCH', `/admin/users/${bobId}`, {
        bearer: adminG.accessToken,
        body: { status: 'disabled' },
      });
      expect(disable.status).toBe(200);
      expect(disable.body.status).toBe('disabled');

      // The unexpired access token dies on the very next call…
      const dead = await call(baseUrl, 'GET', '/auth/me', { bearer: bobBearer });
      expect(dead.status).toBe(401);
      // …and the refresh token was revoked with the account.
      const deadRefresh = await call(baseUrl, 'POST', '/auth/refresh', {
        body: { refreshToken: claim.body.refreshToken },
      });
      expect(deadRefresh.status).toBe(401);

      const reenable = await call<UserView>(baseUrl, 'PATCH', `/admin/users/${bobId}`, {
        bearer: adminG.accessToken,
        body: { status: 'active' },
      });
      expect(reenable.status).toBe(200);
      const restored = await call<UserView>(baseUrl, 'GET', '/auth/me', { bearer: bobBearer });
      expect(restored.status).toBe(200);
    });

    it('admin surface validation, 404s and last-admin protection', async () => {
      const unknown = await call(
        baseUrl,
        'PATCH',
        '/admin/users/00000000-0000-4000-8000-000000000000',
        {
          bearer: adminG.accessToken,
          body: { role: 'user' },
        },
      );
      expect(unknown.status).toBe(404);
      expect(problem(unknown).code).toBe('NOT_FOUND');

      const malformed = await call(baseUrl, 'PATCH', '/admin/users/not-a-uuid', {
        bearer: adminG.accessToken,
        body: { role: 'user' },
      });
      expect(malformed.status).toBe(400);
      expect(problem(malformed).code).toBe('VALIDATION_FAILED');

      const badBody = await call(
        baseUrl,
        'PATCH',
        '/admin/users/00000000-0000-4000-8000-000000000000',
        {
          bearer: adminG.accessToken,
          body: { role: 'superadmin' },
        },
      );
      expect(badBody.status).toBe(400);

      const me = await call<UserView>(baseUrl, 'GET', '/auth/me', { bearer: adminG.accessToken });
      const adminId = me.body.id;

      const demote = await call(baseUrl, 'PATCH', `/admin/users/${adminId}`, {
        bearer: adminG.accessToken,
        body: { role: 'user' },
      });
      expect(demote.status).toBe(409);
      expect(problem(demote).code).toBe('CONFLICT');

      const disable = await call(baseUrl, 'PATCH', `/admin/users/${adminId}`, {
        bearer: adminG.accessToken,
        body: { status: 'disabled' },
      });
      expect(disable.status).toBe(409);

      const users = await call<UserView[]>(baseUrl, 'GET', '/admin/users', {
        bearer: adminG.accessToken,
      });
      const emails = users.body.map((u) => u.email).sort();
      expect(emails).toEqual([
        'alice@arcdrop.test',
        'bob@arcdrop.test',
        'carol@arcdrop.test',
        'dave@arcdrop.test',
        ADMIN_EMAIL,
      ]);
    });
  });

  describe('throttling boot — strict /auth/* budget in isolation', () => {
    let app: INestApplication;
    let baseUrl: string;

    beforeAll(async () => {
      installTestEnv();
      const booted = await bootApp();
      app = booted.app;
      baseUrl = booted.baseUrl;
      const dataSource = app.get(DataSource);
      await dataSource.query('DELETE FROM refresh_tokens');
      await dataSource.query('DELETE FROM one_time_tokens');
      await dataSource.query('DELETE FROM users');
      await dataSource.query('DELETE FROM settings');
      await call<AuthSession>(baseUrl, 'POST', '/auth/bootstrap', {
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      });
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('the 11th login inside the window is a 429 problem+json', async () => {
      let sawUnauthorized = 0;
      let limited: CallResult<unknown> | null = null;
      for (let attempt = 0; attempt < 11; attempt++) {
        const r = await call(baseUrl, 'POST', '/auth/login', {
          body: { email: ADMIN_EMAIL, password: 'wrong-password-1' },
        });
        if (r.status === 401) {
          sawUnauthorized++;
          expect(problem(r).code).toBe('UNAUTHORIZED');
        } else if (r.status === 429 && limited === null) {
          limited = r;
        } else {
          throw new Error(`unexpected status ${r.status} on attempt ${attempt + 1}`);
        }
      }
      // 10 attempts pass the throttler (and fail auth); the 11th is limited.
      expect(sawUnauthorized).toBe(10);
      expect(limited).not.toBeNull();
      expect(limited!.status).toBe(429);
      expect(limited!.contentType.startsWith('application/problem+json')).toBe(true);
      const p = problem(limited!);
      expect(p.code).toBe('TOO_MANY_REQUESTS');
      expect(p.status).toBe(429);
    });
  });
});
