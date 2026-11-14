import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { installTestEnv } from './helpers';

interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: string };
}

interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId?: string;
}

interface CallResult<T> {
  status: number;
  body: T;
  contentType: string;
  headers: Headers;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function call<T = Record<string, unknown>>(
  baseUrl: string,
  method: Method,
  path: string,
  init: { body?: unknown; rawBody?: string; bearer?: string; requestId?: string } = {},
): Promise<CallResult<T>> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined || init.rawBody !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (init.bearer) headers['authorization'] = `Bearer ${init.bearer}`;
  if (init.requestId) headers['x-request-id'] = init.requestId;

  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  const contentType = res.headers.get('content-type') ?? '';
  const body = (
    contentType.includes('json') ? ((await res.json()) as T) : ((await res.text()) as unknown as T)
  ) as T;
  return { status: res.status, body, contentType, headers: res.headers };
}

const problem = (r: CallResult<unknown>) => r.body as unknown as Problem;

async function wipeData(dataSource: DataSource): Promise<void> {
  await dataSource.query('DELETE FROM audit_log_entries');
  await dataSource.query('DELETE FROM personal_access_tokens');
  await dataSource.query('DELETE FROM change_events');
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

async function bootApp(): Promise<{ app: INestApplication; baseUrl: string }> {
  // Disable IP throttler in functional M9 tests so isolated per-user / audit
  // assertions aren't mixed with per-IP throttling; IP & auth rate limits are
  // exercised directly in `scripts/load-smoke.ts` against a real process.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_GUARD)
    .useValue({ canActivate: () => true })
    .compile();
  const config = loadConfig();
  const app = moduleRef.createNestApplication({ logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(0);
  return { app, baseUrl: await app.getUrl() };
}

async function bootstrapAdmin(baseUrl: string): Promise<AuthSession> {
  const res = await call<AuthSession>(baseUrl, 'POST', '/auth/bootstrap', {
    body: { email: 'root@arcdrop.test', password: 'root-password-1' },
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function createUserViaAdmin(
  baseUrl: string,
  admin: AuthSession,
  email: string,
): Promise<{ session: AuthSession; inviteToken: string }> {
  const res = await call<{ user: { id: string }; invite: { token: string } }>(
    baseUrl,
    'POST',
    '/admin/users',
    {
      bearer: admin.accessToken,
      body: { email },
    },
  );
  expect(res.status).toBe(201);
  const claim = await call<AuthSession>(baseUrl, 'POST', '/auth/claim', {
    body: { token: res.body.invite.token, password: 'user-password-1' },
  });
  expect(claim.status).toBe(201);
  return { session: claim.body, inviteToken: res.body.invite.token };
}

async function createPat(baseUrl: string, bearer: string, name: string) {
  const res = await call<{ id: string; token: string }>(baseUrl, 'POST', '/me/tokens', {
    bearer,
    body: { name },
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function importTxt(baseUrl: string, bearer: string, url: string) {
  const form = new FormData();
  form.append('file', new Blob([`${url}\n`], { type: 'text/plain' }), 'links.txt');
  const res = await fetch(`${baseUrl}/api/v1/data/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
    body: form,
  });
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe('M9 Hardening & ops (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  describe('boot A — admin audit surface, JSON body limits, OpenAPI problem+json sweep', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let alice: AuthSession;
    let adminPat: { id: string; token: string };
    let aliceInviteToken: string;

    beforeAll(async () => {
      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      const created = await createUserViaAdmin(baseUrl, admin, 'alice-m9@arcdrop.test');
      alice = created.session;
      aliceInviteToken = created.inviteToken;
      adminPat = await createPat(baseUrl, admin.accessToken, 'Admin PAT');
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('GET /admin/audit enforces admin session only (401 anon, 403 user & PAT)', async () => {
      const anon = await call(baseUrl, 'GET', '/admin/audit');
      expect(anon.status).toBe(401);
      expect(problem(anon).code).toBe('UNAUTHORIZED');

      const user = await call(baseUrl, 'GET', '/admin/audit', { bearer: alice.accessToken });
      expect(user.status).toBe(403);
      expect(problem(user).code).toBe('FORBIDDEN');

      const pat = await call(baseUrl, 'GET', '/admin/audit', { bearer: adminPat.token });
      expect(pat.status).toBe(403);
      expect(problem(pat).code).toBe('FORBIDDEN');
      expect(problem(pat).detail).toContain('admin surface');
    });

    it('admin user/settings actions are audited without leaking invite or reset tokens', async () => {
      const updateUser = await call(baseUrl, 'PATCH', `/admin/users/${alice.user.id}`, {
        bearer: admin.accessToken,
        body: { active: false },
      });
      expect(updateUser.status).toBe(200);

      const reactivate = await call(baseUrl, 'PATCH', `/admin/users/${alice.user.id}`, {
        bearer: admin.accessToken,
        body: { active: true },
      });
      expect(reactivate.status).toBe(200);

      const reset = await call<{ reset: { token: string } }>(
        baseUrl,
        'POST',
        `/admin/users/${alice.user.id}/reset-password`,
        { bearer: admin.accessToken },
      );
      expect(reset.status).toBe(200);
      const resetToken = reset.body.reset.token;

      const settings = await call(baseUrl, 'PUT', '/admin/settings', {
        bearer: admin.accessToken,
        body: { siteTitle: 'ArcDrop Hardened' },
      });
      expect(settings.status).toBe(200);

      // Failed admin action is also audited with outcome = error
      const missingUser = await call(
        baseUrl,
        'PATCH',
        '/admin/users/00000000-0000-4000-8000-000000000000',
        { bearer: admin.accessToken, body: { active: false } },
      );
      expect(missingUser.status).toBe(404);

      // Also exercise an MCP tool call so both admin.* and mcp.* entries appear together.
      const initRes = await fetch(`${baseUrl}/api/v1/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${adminPat.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'm9-e2e', version: '0.0.0' },
          },
        }),
      });
      const mcpSession = initRes.headers.get('mcp-session-id')!;
      await fetch(`${baseUrl}/api/v1/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${adminPat.token}`,
          'mcp-session-id': mcpSession,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'getBookmarkStats', arguments: {} },
        }),
      });
      // Tool audit is fire-and-forget — allow it to settle before querying.
      await new Promise((resolve) => setTimeout(resolve, 60));

      const list = await call<{
        items: Array<{
          id: string;
          userId: string;
          actorType: string;
          action: string;
          subject: string;
          outcome: string;
          detail: Record<string, unknown> | null;
          createdAt: string;
        }>;
        totalCount: number;
        page: number;
        pageSize: number;
      }>(baseUrl, 'GET', '/admin/audit?page=1&pageSize=20', { bearer: admin.accessToken });
      expect(list.status).toBe(200);
      expect(list.body.totalCount).toBeGreaterThanOrEqual(6);

      const serialized = JSON.stringify(list.body);
      expect(serialized).not.toContain(aliceInviteToken);
      expect(serialized).not.toContain(resetToken);

      const actions = list.body.items.map((item) => item.action);
      expect(actions).toContain('admin.user.create');
      expect(actions).toContain('admin.user.update');
      expect(actions).toContain('admin.user.reset_password');
      expect(actions).toContain('admin.settings.update');
      expect(actions).toContain('mcp.tools.call');

      // Filters work deterministically
      const errorsOnly = await call<typeof list.body>(
        baseUrl,
        'GET',
        '/admin/audit?outcome=error',
        { bearer: admin.accessToken },
      );
      expect(errorsOnly.status).toBe(200);
      expect(errorsOnly.body.items.some((e) => e.action === 'admin.user.update')).toBe(true);
      expect(errorsOnly.body.items.every((e) => e.outcome === 'error')).toBe(true);

      const patOnly = await call<typeof list.body>(baseUrl, 'GET', '/admin/audit?actorType=pat', {
        bearer: admin.accessToken,
      });
      expect(patOnly.status).toBe(200);
      expect(patOnly.body.items.length).toBeGreaterThanOrEqual(1);
      expect(patOnly.body.items.every((e) => e.actorType === 'pat')).toBe(true);

      const paged = await call<typeof list.body>(baseUrl, 'GET', '/admin/audit?page=1&pageSize=2', {
        bearer: admin.accessToken,
      });
      expect(paged.status).toBe(200);
      expect(paged.body.items.length).toBe(2);
      expect(paged.body.pageSize).toBe(2);
    });

    it('revisit #2: REST JSON body limit is 256 KB (413 problem+json), malformed JSON is 400 problem+json, MCP keeps 2 MB', async () => {
      const oversizedRest = await call(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        requestId: 'm9-body-413',
        body: {
          url: 'https://example.com/big',
          notes: 'x'.repeat(300 * 1024),
        },
      });
      expect(oversizedRest.status).toBe(413);
      expect(oversizedRest.contentType.startsWith('application/problem+json')).toBe(true);
      expect(problem(oversizedRest).code).toBe('PAYLOAD_TOO_LARGE');
      expect(problem(oversizedRest).requestId).toBe('m9-body-413');
      expect(oversizedRest.headers.get('x-request-id')).toBe('m9-body-413');

      const malformed = await call(baseUrl, 'POST', '/bookmarks', {
        bearer: alice.accessToken,
        requestId: 'm9-body-400',
        rawBody: '{"url": ',
      });
      expect(malformed.status).toBe(400);
      expect(malformed.contentType.startsWith('application/problem+json')).toBe(true);
      expect(problem(malformed).code).toBe('BAD_REQUEST');
      expect(problem(malformed).requestId).toBe('m9-body-400');

      // /api/v1/mcp keeps the 2 MB envelope (>256 KB passes JSON parser without 413)
      const mcpMediumRes = await fetch(`${baseUrl}/api/v1/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${adminPat.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 99,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'big-client', version: '0.0.0', pad: 'p'.repeat(350 * 1024) },
          },
        }),
      });
      expect(mcpMediumRes.status).toBe(200);

      // >2 MB on /api/v1/mcp returns 413 problem+json
      const mcpTooBig = await fetch(`${baseUrl}/api/v1/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${adminPat.token}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 100,
          method: 'initialize',
          params: { pad: 'p'.repeat(2_200_000) },
        }),
      });
      expect(mcpTooBig.status).toBe(413);
      expect(mcpTooBig.headers.get('content-type')?.startsWith('application/problem+json')).toBe(
        true,
      );
    });

    it('final OpenAPI sweep: ProblemDetails schema, reusable responses, operationIds, and problem+json examples on every route', async () => {
      const openapi = (await fetch(`${baseUrl}/openapi.json`).then((r) => r.json())) as {
        components?: {
          schemas?: Record<string, unknown>;
          responses?: Record<string, unknown>;
        };
        paths: Record<
          string,
          Record<
            string,
            {
              operationId?: string;
              summary?: string;
              security?: Array<Record<string, unknown>>;
              responses?: Record<
                string,
                {
                  content?: Record<
                    string,
                    { schema?: { $ref?: string }; example?: Record<string, unknown> }
                  >;
                }
              >;
            }
          >
        >;
      };

      expect(openapi.components?.schemas?.['ProblemDetailsDto']).toBeDefined();
      expect(openapi.components?.responses?.['Problem400']).toBeDefined();
      expect(openapi.components?.responses?.['Problem429']).toBeDefined();
      expect(openapi.components?.responses?.['Problem500']).toBeDefined();

      const paths = Object.entries(openapi.paths);
      expect(paths.length).toBeGreaterThan(25);
      for (const [path, pathItem] of paths) {
        for (const [method, operation] of Object.entries(pathItem)) {
          expect(typeof operation.operationId).toBe('string');
          expect(operation.operationId!.length).toBeGreaterThan(0);
          expect(typeof operation.summary).toBe('string');
          expect(operation.summary!.length).toBeGreaterThan(0);

          const r429 = operation.responses?.['429']?.content?.['application/problem+json'];
          expect(r429?.schema?.$ref).toBe('#/components/schemas/ProblemDetailsDto');
          expect(r429?.example?.['code']).toBe('TOO_MANY_REQUESTS');

          const r500 = operation.responses?.['500']?.content?.['application/problem+json'];
          expect(r500?.schema?.$ref).toBe('#/components/schemas/ProblemDetailsDto');
          expect(r500?.example?.['code']).toBe('INTERNAL_ERROR');

          if (method === 'post' || method === 'put' || method === 'patch') {
            const r400 = operation.responses?.['400']?.content?.['application/problem+json'];
            expect(r400?.schema?.$ref).toBe('#/components/schemas/ProblemDetailsDto');
            expect(r400?.example?.['code']).toBe('VALIDATION_FAILED');
          }

          const secured = operation.security?.some((s) => 'bearer' in s);
          if (secured) {
            const r401 = operation.responses?.['401']?.content?.['application/problem+json'];
            expect(r401?.example?.['code']).toBe('UNAUTHORIZED');
            if (!path.endsWith('/mcp')) {
              const r403 = operation.responses?.['403']?.content?.['application/problem+json'];
              expect(r403?.example?.['code']).toBe('FORBIDDEN');
            }
          }
        }
      }
    });
  });

  describe('boot B — isolated per-user expensive route rate limits (import, reindex, mcpTools)', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let bob: AuthSession;
    let bookmarkId: string;
    let savedImport: string | undefined;
    let savedReindex: string | undefined;
    let savedMcpTools: string | undefined;

    beforeAll(async () => {
      savedImport = process.env['ARCDROP__RATE_LIMIT__IMPORT_PER_MINUTE'];
      savedReindex = process.env['ARCDROP__RATE_LIMIT__REINDEX_PER_MINUTE'];
      savedMcpTools = process.env['ARCDROP__RATE_LIMIT__MCP_TOOLS_PER_MINUTE'];
      process.env['ARCDROP__RATE_LIMIT__IMPORT_PER_MINUTE'] = '2';
      process.env['ARCDROP__RATE_LIMIT__REINDEX_PER_MINUTE'] = '2';
      process.env['ARCDROP__RATE_LIMIT__MCP_TOOLS_PER_MINUTE'] = '3';

      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      bob = (await createUserViaAdmin(baseUrl, admin, 'bob-ratelimit@arcdrop.test')).session;

      const bm = await call<{ id: string }>(baseUrl, 'POST', '/bookmarks', {
        bearer: admin.accessToken,
        body: { url: 'https://example.com/reindex-target', title: 'Target' },
      });
      expect(bm.status).toBe(201);
      bookmarkId = bm.body.id;
    }, 60_000);

    afterAll(async () => {
      if (savedImport === undefined) delete process.env['ARCDROP__RATE_LIMIT__IMPORT_PER_MINUTE'];
      else process.env['ARCDROP__RATE_LIMIT__IMPORT_PER_MINUTE'] = savedImport;
      if (savedReindex === undefined) delete process.env['ARCDROP__RATE_LIMIT__REINDEX_PER_MINUTE'];
      else process.env['ARCDROP__RATE_LIMIT__REINDEX_PER_MINUTE'] = savedReindex;
      if (savedMcpTools === undefined)
        delete process.env['ARCDROP__RATE_LIMIT__MCP_TOOLS_PER_MINUTE'];
      else process.env['ARCDROP__RATE_LIMIT__MCP_TOOLS_PER_MINUTE'] = savedMcpTools;

      // Allow fire-and-forget MCP audit inserts to settle before closing TypeORM.
      await new Promise((resolve) => setTimeout(resolve, 60));
      if (app !== undefined) await app.close();
    });

    it('per-user import rate limit trips on the 3rd request (429 problem+json) without affecting other users', async () => {
      expect((await importTxt(baseUrl, admin.accessToken, 'https://example.com/i1')).status).toBe(
        200,
      );
      expect((await importTxt(baseUrl, admin.accessToken, 'https://example.com/i2')).status).toBe(
        200,
      );
      const blocked = await importTxt(baseUrl, admin.accessToken, 'https://example.com/i3');
      expect(blocked.status).toBe(429);
      expect(blocked.body['code']).toBe('TOO_MANY_REQUESTS');

      // Separate user retains full quota
      expect((await importTxt(baseUrl, bob.accessToken, 'https://example.com/b1')).status).toBe(
        200,
      );
    });

    it('per-user reindex rate limit trips on the 3rd request (429 problem+json)', async () => {
      const r1 = await call(baseUrl, 'POST', `/bookmarks/${bookmarkId}/reindex`, {
        bearer: admin.accessToken,
      });
      const r2 = await call(baseUrl, 'POST', `/bookmarks/${bookmarkId}/reindex`, {
        bearer: admin.accessToken,
      });
      const r3 = await call(baseUrl, 'POST', `/bookmarks/${bookmarkId}/reindex`, {
        bearer: admin.accessToken,
      });
      expect(r1.status).toBe(202);
      expect(r2.status).toBe(202);
      expect(r3.status).toBe(429);
      expect(problem(r3).code).toBe('TOO_MANY_REQUESTS');
    });

    it('per-user MCP tools/call rate limit counts tools/call only and trips on the 4th call (429 problem+json)', async () => {
      const initRes = await fetch(`${baseUrl}/api/v1/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${admin.accessToken}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'rl-client', version: '0.0.0' },
          },
        }),
      });
      expect(initRes.status).toBe(200);
      const mcpSession = initRes.headers.get('mcp-session-id')!;

      // tools/list does NOT consume the tools/call budget
      for (let i = 0; i < 4; i++) {
        const listed = await fetch(`${baseUrl}/api/v1/mcp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${admin.accessToken}`,
            'mcp-session-id': mcpSession,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 10 + i, method: 'tools/list' }),
        });
        expect(listed.status).toBe(200);
      }

      // First 3 tools/call succeed; 4th trips 429 problem+json
      for (let i = 0; i < 3; i++) {
        const ok = await fetch(`${baseUrl}/api/v1/mcp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${admin.accessToken}`,
            'mcp-session-id': mcpSession,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 20 + i,
            method: 'tools/call',
            params: { name: 'getBookmarkStats', arguments: {} },
          }),
        });
        expect(ok.status).toBe(200);
      }

      const fourth = await fetch(`${baseUrl}/api/v1/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${admin.accessToken}`,
          'mcp-session-id': mcpSession,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 23,
          method: 'tools/call',
          params: { name: 'getBookmarkStats', arguments: {} },
        }),
      });
      expect(fourth.status).toBe(429);
      expect(fourth.headers.get('content-type')?.startsWith('application/problem+json')).toBe(true);
      const body = (await fourth.json()) as Problem;
      expect(body.code).toBe('TOO_MANY_REQUESTS');
    });
  });
});
