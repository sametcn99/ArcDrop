import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { WebSocket as WsClient } from 'ws';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { loadConfig } from '../src/config/load-config';
import { createDataSource } from '../src/database/data-source';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { installTestEnv } from './helpers';

/**
 * M7 — MCP server, personal access tokens, audit (plan D23).
 *
 * Everything runs against real Postgres through the real app. Covers the
 * ticket's acceptance criteria: the full Streamable-HTTP handshake over a
 * PAT (initialize → tools/list → tools/call), the agent-as-first-class-
 * client proof (a tools/call mutation is REST-visible, change-logged AND
 * ws-pushed to a connected device), the PAT lifecycle, read-only refusals
 * (per tool over MCP, per method over REST), tools/list ↔ DTO ↔ OpenAPI
 * parity, spec-compliant JSON-RPC errors, the audit trail, the per-PAT
 * rate budget (isolated boot), and the D23 negative: no /ai/* routes.
 */

// -- MCP JSON-RPC plumbing ---------------------------------------------------

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

interface McpResponse {
  status: number;
  contentType: string;
  sessionId?: string;
  message: JsonRpcMessage | null;
}

const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

/** POST one JSON-RPC message; transparently reads JSON or SSE responses. */
async function mcpPost(
  baseUrl: string,
  bearer: string | undefined,
  body: unknown,
  sessionId?: string,
): Promise<McpResponse> {
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (bearer !== undefined) headers['authorization'] = `Bearer ${bearer}`;
  if (sessionId !== undefined) headers['mcp-session-id'] = sessionId;
  const res = await fetch(`${baseUrl}/api/v1/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get('content-type') ?? '';
  let message: JsonRpcMessage | null = null;
  if (contentType.includes('json') || contentType.includes('event-stream')) {
    const text = await res.text();
    if (contentType.includes('event-stream')) {
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const parsed = JSON.parse(line.slice(5).trim()) as JsonRpcMessage;
        if (parsed.id === (body as JsonRpcMessage).id) message = parsed;
      }
    } else if (text.length > 0) {
      message = JSON.parse(text) as JsonRpcMessage;
    }
  }
  return {
    status: res.status,
    contentType,
    sessionId: res.headers.get('mcp-session-id') ?? undefined,
    message,
  };
}

/** HTTP DELETE — the MCP session-termination verb (transport answers 202). */
async function mcpDelete(baseUrl: string, bearer: string, sessionId: string): Promise<number> {
  const res = await fetch(`${baseUrl}/api/v1/mcp`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${bearer}`,
      'mcp-session-id': sessionId,
    },
  });
  return res.status;
}

function rpcRequest(id: number, method: string, params?: unknown): JsonRpcMessage {
  return {
    jsonrpc: '2.0',
    id,
    method,
    ...(params !== undefined ? { params } : {}),
  } as JsonRpcMessage;
}

async function initialize(baseUrl: string, bearer: string): Promise<McpResponse> {
  return mcpPost(baseUrl, bearer, {
    ...rpcRequest(1, 'initialize'),
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'arcdrop-e2e', version: '0.0.0' },
    },
  });
}

// -- generic REST helpers (same shape as the other suites) -------------------

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
): Promise<AuthSession> {
  const res = await call<{ invite: { token: string } }>(baseUrl, 'POST', '/admin/users', {
    bearer: admin.accessToken,
    body: { email },
  });
  expect(res.status).toBe(201);
  const claim = await call<AuthSession>(baseUrl, 'POST', '/auth/claim', {
    body: { token: res.body.invite.token, password: 'user-password-1' },
  });
  expect(claim.status).toBe(201);
  return claim.body;
}

async function createPat(
  baseUrl: string,
  bearer: string,
  name: string,
  readOnly = false,
): Promise<{ id: string; token: string; name: string; readOnly: boolean }> {
  const res = await call<{ id: string; token: string; name: string; readOnly: boolean }>(
    baseUrl,
    'POST',
    '/me/tokens',
    { bearer, body: { name, readOnly } },
  );
  expect(res.status).toBe(201);
  return res.body;
}

// -- ws push helper (device watching while an agent mutates) -----------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ChangeNotification {
  seq: string;
  entity: string;
  id: string;
  action: string;
}

function connectSyncWs(
  baseUrl: string,
  ticket: string,
): {
  client: WsClient;
  messages: ChangeNotification[];
  opened: Promise<void>;
} {
  const url = `${baseUrl.replace(/^http/, 'ws')}/api/v1/sync/ws?ticket=${encodeURIComponent(ticket)}`;
  const client = new WsClient(url);
  const socket = {
    client,
    opened: new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', (err) => reject(err));
    }),
    messages: [] as ChangeNotification[],
  };
  client.on('message', (data) => {
    try {
      socket.messages.push(JSON.parse(data.toString()) as ChangeNotification);
    } catch {
      // non-JSON frames are not part of the contract
    }
  });
  client.on('error', () => {});
  return socket;
}

async function waitFor(
  socket: { messages: ChangeNotification[] },
  predicate: (change: ChangeNotification) => boolean,
  timeoutMs = 3000,
): Promise<ChangeNotification> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = socket.messages.find(predicate);
    if (found) return found;
    await sleep(20);
  }
  throw new Error('expected change notification did not arrive within the deadline');
}

/** The catalog per the tickets — M8 portability, M10 highlights, M12 library health, M13 bulk operations, M14 notifications, M16 manual ordering, M17 archive. */
const EXPECTED_TOOLS = [
  'listBookmarks',
  'getBookmark',
  'getBookmarkArchive',
  'createBookmark',
  'updateBookmark',
  'deleteBookmark',
  'restoreBookmark',
  'bulkBookmarks',
  'listHighlights',
  'createHighlight',
  'updateHighlight',
  'deleteHighlight',
  'replaceBookmarkTags',
  'replaceBookmarkCollections',
  'reindexBookmark',
  'getBookmarkStats',
  'listBookmarkTags',
  'renameTag',
  'deleteTag',
  'listCollections',
  'getCollectionTree',
  'getCollection',
  'createCollection',
  'updateCollection',
  'deleteCollection',
  'restoreCollection',
  'reorderCollections',
  'reorderCollectionBookmarks',
  'mergeCollections',
  'sortCollectionsAlphabetical',
  'deleteEmptyCollections',
  'listNotifications',
  'markNotificationsRead',
  'getSyncState',
  'listSyncChanges',
  'createSyncTicket',
  'exportData',
  'importData',
  'exportBookmarkHighlights',
  'findDuplicates',
  'resolveDuplicates',
] as const;

// ---------------------------------------------------------------------------

describe('MCP server (e2e)', () => {
  beforeAll(async () => {
    installTestEnv();
    const runner = createDataSource(loadConfig());
    await runner.initialize();
    await runner.runMigrations();
    await runner.destroy();
  }, 60_000);

  describe('boot A — handshake, parity, PAT lifecycle, guardrails, audit', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let alice: AuthSession;
    let bob: AuthSession;
    let alicePat: { id: string; token: string };
    let aliceReadOnlyPat: { id: string; token: string };
    let sessionId: string;
    let readOnlySession: string;

    beforeAll(async () => {
      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);

      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      alice = await createUserViaAdmin(baseUrl, admin, 'alice-mcp@arcdrop.test');
      bob = await createUserViaAdmin(baseUrl, admin, 'bob-mcp@arcdrop.test');
      alicePat = await createPat(baseUrl, alice.accessToken, 'Alice agent');
      aliceReadOnlyPat = await createPat(baseUrl, alice.accessToken, 'Alice reader', true);
    }, 60_000);

    afterAll(async () => {
      await app.close();
    });

    it('D23 negative: no /ai/* routes exist (404 over HTTP + grep over the source)', async () => {
      for (const attempt of [
        { method: 'GET' as Method, path: '/ai/providers' },
        { method: 'POST' as Method, path: '/ai/organize' },
        { method: 'GET' as Method, path: '/ai' },
      ]) {
        const res = await call(baseUrl, attempt.method, attempt.path, {
          bearer: alice.accessToken,
        });
        expect(res.status).toBe(404);
        expect(problem(res).code).toBe('NOT_FOUND');
      }
      // grep half of the AC: no source file wires an /ai route or an AI module.
      // (bun test runs with cwd = apps/api.)
      const srcDir = join(process.cwd(), 'src');
      const offenders: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.ts')) {
            const text = readFileSync(full, 'utf8');
            if (/AiProvider|AiModule|Controller\('ai'\)|['"`]\/ai\//.test(text)) {
              offenders.push(full);
            }
          }
        }
      };
      walk(srcDir);
      expect(offenders).toEqual([]);
    });

    it('mints and lists PATs — the raw token appears exactly once', async () => {
      expect(alicePat.token.startsWith('arcdrop_pat_')).toBe(true);
      const list = await call<{ items: Array<Record<string, unknown>> }>(
        baseUrl,
        'GET',
        '/me/tokens',
        { bearer: alice.accessToken },
      );
      expect(list.status).toBe(200);
      const mine = list.body.items.find((item) => item['id'] === alicePat.id);
      expect(mine).toBeDefined();
      expect(mine!['name']).toBe('Alice agent');
      expect(mine!['readOnly']).toBe(false);
      expect(mine!['lastUsedAt']).toBeNull();
      expect(JSON.stringify(list.body)).not.toContain('arcdrop_pat_');
      expect(JSON.stringify(list.body)).not.toContain(alicePat.token);
    });

    it('PAT-authenticated requests are tagged: they work, and lastUsedAt moves', async () => {
      const before = await call<{ items: Array<{ id: string; lastUsedAt: string | null }> }>(
        baseUrl,
        'GET',
        '/me/tokens',
        { bearer: alice.accessToken },
      );
      expect(before.body.items.find((t) => t.id === alicePat.id)?.lastUsedAt).toBeNull();

      const read = await call(baseUrl, 'GET', '/bookmarks', { bearer: alicePat.token });
      expect(read.status).toBe(200);

      const after = await call<{ items: Array<{ id: string; lastUsedAt: string | null }> }>(
        baseUrl,
        'GET',
        '/me/tokens',
        { bearer: alice.accessToken },
      );
      expect(after.body.items.find((t) => t.id === alicePat.id)?.lastUsedAt).not.toBeNull();
    });

    it('handshake: initialize → Mcp-Session-Id → tools/list → tools/call, all over the PAT', async () => {
      const init = await initialize(baseUrl, alicePat.token);
      expect(init.status).toBe(200);
      expect(init.sessionId).toBeDefined();
      expect(init.message?.error).toBeUndefined();
      const serverInfo = (init.message?.result as Record<string, Record<string, unknown>>)[
        'serverInfo'
      ]!;
      expect(serverInfo['name']).toBe('arcdrop');
      sessionId = init.sessionId!;

      // a second initialize (new session) also works — sessions are independent
      const second = await initialize(baseUrl, alicePat.token);
      expect(second.sessionId).not.toBe(sessionId);

      const tools = await mcpPost(baseUrl, alicePat.token, rpcRequest(2, 'tools/list'), sessionId);
      expect(tools.status).toBe(200);
      const toolList = (tools.message?.result as { tools: Array<{ name: string }> }).tools;
      expect(toolList.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());

      const callRes = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(3, 'tools/call', {
          name: 'createBookmark',
          arguments: { url: 'https://arcdrop.dev/guide?page=2', title: 'ArcDrop guide' },
        }),
        sessionId,
      );
      expect(callRes.status).toBe(200);
      expect(callRes.message?.error).toBeUndefined();
      const structured = callRes.message?.result?.['structuredContent'] as Record<string, unknown>;
      expect(structured['url']).toBe('https://arcdrop.dev/guide?page=2');
      expect((structured['urlParts'] as Record<string, unknown>)['host']).toBe('arcdrop.dev');
    });

    it('agent = first-class client: the tool call is REST-visible, change-logged AND ws-pushed', async () => {
      const ticket = await call<{ ticket: string }>(baseUrl, 'POST', '/sync/ticket', {
        bearer: alice.accessToken,
      });
      expect(ticket.status).toBe(201);
      const device = connectSyncWs(baseUrl, ticket.body.ticket);
      await device.opened;

      const before = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
        bearer: alice.accessToken,
      });
      const seqBefore = BigInt(before.body.seq);

      const created = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(10, 'tools/call', {
          name: 'createBookmark',
          arguments: { url: 'https://example.com/article', title: 'Example article' },
        }),
        sessionId,
      );
      expect(created.message?.error).toBeUndefined();
      const bookmarkId = (created.message?.result?.['structuredContent'] as { id: string }).id;

      // 1. REST-visible through the JWT (a different client sees the agent's write)
      const viaRest = await call<{ id: string; url: string; title: string | null }>(
        baseUrl,
        'GET',
        `/bookmarks/${bookmarkId}`,
        { bearer: alice.accessToken },
      );
      expect(viaRest.status).toBe(200);
      expect(viaRest.body.url).toBe('https://example.com/article');

      // 2. change-logged (cursor moved by exactly one; the delta carries the snapshot)
      const state = await call<{ seq: string }>(baseUrl, 'GET', '/sync/state', {
        bearer: alice.accessToken,
      });
      expect(BigInt(state.body.seq)).toBe(seqBefore + 1n);
      const changes = await call<{
        changes: Array<{
          seq: string;
          entity: string;
          action: string;
          id: string;
          snapshot: unknown;
        }>;
      }>(baseUrl, 'GET', `/sync/changes?since=${before.body.seq}`, { bearer: alice.accessToken });
      expect(changes.body.changes).toHaveLength(1);
      expect(changes.body.changes[0]).toMatchObject({
        entity: 'bookmark',
        action: 'create',
        id: bookmarkId,
      });
      expect((changes.body.changes[0]!.snapshot as { url: string }).url).toBe(
        'https://example.com/article',
      );

      // 3. ws-pushed to the connected device
      const pushed = await waitFor(device, (c) => c.id === bookmarkId);
      expect(pushed).toMatchObject({ entity: 'bookmark', action: 'create' });
      expect(pushed.seq).toBe(changes.body.changes[0]!.seq);
      device.client.close();
    });

    it('an official SDK client connects over the PAT (real agent stack)', async () => {
      const client = new Client({ name: 'e2e-sdk-client', version: '0.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/v1/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${alicePat.token}` } },
      });
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.length).toBe(EXPECTED_TOOLS.length);
      const called = await client.callTool({
        name: 'getBookmarkStats',
        arguments: {},
      });
      expect((called.content as Array<{ text: string }>)[0]?.text).toContain('"total"');
      await client.close();
    });

    it('tools/list parity: schemas are DTO-derived and cover exactly the agent REST surface', async () => {
      const tools = await mcpPost(baseUrl, alicePat.token, rpcRequest(20, 'tools/list'), sessionId);
      const toolList = (
        tools.message?.result as {
          tools: Array<{
            name: string;
            inputSchema: Record<string, unknown>;
            annotations: { readOnlyHint?: boolean };
          }>;
        }
      ).tools;
      const byName = new Map(toolList.map((t) => [t.name, t]));

      // schemas derive from the DTOs: createBookmark accepts quick-add query params or body fields
      const createSchema = byName.get('createBookmark')!.inputSchema;
      expect(createSchema['required'] as string[]).toEqual(['url']);
      expect(
        (
          (createSchema['properties'] as Record<string, Record<string, unknown>>)['url'] as Record<
            string,
            unknown
          >
        )['maxLength'],
      ).toBe(2048);
      // composite tool: id param + tags body, both required, merged flat
      const replaceTags = byName.get('replaceBookmarkTags')!.inputSchema;
      expect((replaceTags['required'] as string[]).sort()).toEqual(['id', 'tags'].sort());
      expect(
        (
          (replaceTags['properties'] as Record<string, Record<string, unknown>>)['tags'] as Record<
            string,
            unknown
          >
        )['maxItems'],
      ).toBe(50);

      // readOnlyHint mirrors the REST method of the same operation
      const openapi = (await fetch(`${baseUrl}/openapi.json`).then((r) => r.json())) as {
        paths: Record<string, Record<string, Record<string, unknown>>>;
      };
      const restMethods = new Map<string, string>();
      const surfaceOps = new Set<string>();
      for (const [path, pathItem] of Object.entries(openapi.paths)) {
        for (const [method, rawOperation] of Object.entries(pathItem)) {
          const operation = rawOperation as {
            operationId?: string;
            security?: Array<Record<string, string[]>>;
          };
          const operationId = operation.operationId;
          if (!operationId) continue;
          const secured = operation.security?.some((sec) => Object.keys(sec).includes('bearer'));
          const isAgentSurface =
            secured === true &&
            !path.startsWith('/api/v1/admin') &&
            !path.startsWith('/api/v1/auth') &&
            path !== '/api/v1/me' &&
            !path.startsWith('/api/v1/me/') &&
            !path.startsWith('/api/v1/icons') &&
            !path.endsWith('/mcp');
          if (!isAgentSurface) continue;
          surfaceOps.add(operationId);
          restMethods.set(operationId, method.toUpperCase());
        }
      }
      expect(surfaceOps.size).toBe(EXPECTED_TOOLS.length);
      expect([...surfaceOps].sort()).toEqual([...EXPECTED_TOOLS].sort());
      for (const [operationId, method] of restMethods) {
        expect(byName.get(operationId)!.annotations.readOnlyHint).toBe(method === 'GET');
      }
    });
    it('unknown tool → JSON-RPC -32602; bad arguments → -32602 with per-field errors', async () => {
      const unknown = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(30, 'tools/call', { name: 'organizeLibrary', arguments: {} }),
        sessionId,
      );
      expect(unknown.message?.error?.code).toBe(-32602);
      expect(unknown.message?.error?.message).toContain('organizeLibrary');

      const badArgs = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(31, 'tools/call', { name: 'createBookmark', arguments: { url: 42 } }),
        sessionId,
      );
      expect(badArgs.message?.error?.code).toBe(-32602);
      const data = badArgs.message?.error?.data as { errors: Array<{ field: string }> };
      expect(data.errors.some((e) => e.field === 'url')).toBe(true);

      const missing = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(32, 'tools/call', { name: 'createBookmark', arguments: {} }),
        sessionId,
      );
      expect(missing.message?.error?.code).toBe(-32602);
    });

    it('service-level failures (404/409) are spec-compliant TOOL errors, not protocol errors', async () => {
      const missing = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(40, 'tools/call', {
          name: 'getBookmark',
          arguments: { id: '00000000-0000-4000-8000-000000000000' },
        }),
        sessionId,
      );
      expect(missing.status).toBe(200);
      expect(missing.message?.error).toBeUndefined();
      expect(missing.message?.result?.['isError']).toBe(true);
      expect((missing.message?.result?.['content'] as Array<{ text: string }>)[0]?.text).toContain(
        '404',
      );

      // 409: trashing a collection that still has an active child
      const parent = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'parent' },
      });
      const child = await call<{ id: string }>(baseUrl, 'POST', '/collections', {
        bearer: alice.accessToken,
        body: { title: 'child', parentId: parent.body.id },
      });
      expect(child.status).toBe(201);
      const refused = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(41, 'tools/call', {
          name: 'deleteCollection',
          arguments: { id: parent.body.id },
        }),
        sessionId,
      );
      expect(refused.message?.error).toBeUndefined();
      expect(refused.message?.result?.['isError']).toBe(true);
      expect((refused.message?.result?.['content'] as Array<{ text: string }>)[0]?.text).toContain(
        '409',
      );
    });

    it('session discipline: bound to the credential, refused without/with-unknown id, DELETE closes', async () => {
      // no session id on a non-initialize request → 400 JSON-RPC error
      const noSession = await mcpPost(baseUrl, alicePat.token, rpcRequest(50, 'tools/list'));
      expect(noSession.status).toBe(400);
      expect(noSession.message?.error?.code).toBe(-32000);

      // unknown session id → 404
      const ghost = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(51, 'tools/list'),
        '00000000-0000-4000-8000-00000000dead',
      );
      expect(ghost.status).toBe(404);
      expect(ghost.message?.error?.code).toBe(-32001);

      // a DIFFERENT credential cannot ride alice's session (404, never revealed)
      const bobInit = await initialize(baseUrl, bob.accessToken);
      const stolen = await mcpPost(
        baseUrl,
        bob.accessToken,
        rpcRequest(52, 'tools/list'),
        sessionId,
      );
      expect(stolen.status).toBe(404);
      expect(await mcpDelete(baseUrl, bob.accessToken, bobInit.sessionId!)).toBe(200);

      // unauthenticated initialize → the guard speaks first (401)
      const anonymous = await mcpPost(baseUrl, undefined, rpcRequest(53, 'initialize'));
      expect(anonymous.status).toBe(401);

      // DELETE closes the session; the next call on it is a 404
      expect(await mcpDelete(baseUrl, alicePat.token, sessionId)).toBe(200);
      const after = await mcpPost(baseUrl, alicePat.token, rpcRequest(54, 'tools/list'), sessionId);
      expect(after.status).toBe(404);

      // a fresh session for the rest of the suite
      const fresh = await initialize(baseUrl, alicePat.token);
      sessionId = fresh.sessionId!;
    });

    it('read-only PAT: every mutation tool refuses with a spec-compliant tool error', async () => {
      const readOnlyInit = await initialize(baseUrl, aliceReadOnlyPat.token);
      expect(readOnlyInit.status).toBe(200);
      readOnlySession = readOnlyInit.sessionId!;
      const tools = await mcpPost(
        baseUrl,
        aliceReadOnlyPat.token,
        rpcRequest(60, 'tools/list'),
        readOnlySession,
      );
      expect(tools.status).toBe(200);
      const toolList = (
        tools.message?.result as {
          tools: Array<{ name: string; annotations: { readOnlyHint?: boolean } }>;
        }
      ).tools;
      const mutationTools = toolList.filter((t) => t.annotations.readOnlyHint === false);
      expect(mutationTools.length).toBe(EXPECTED_TOOLS.length - 14); // 14 read tools

      let checked = 0;
      for (const tool of mutationTools) {
        const res = await mcpPost(
          baseUrl,
          aliceReadOnlyPat.token,
          rpcRequest(61 + checked, 'tools/call', { name: tool.name, arguments: {} }),
          readOnlySession,
        );
        expect(res.message?.error).toBeUndefined();
        expect(res.message?.result?.['isError']).toBe(true);
        const text = (res.message?.result?.['content'] as Array<{ text: string }>)[0]?.text ?? '';
        expect(text).toContain('read-only');
        expect(text).toContain(tool.name);
        checked += 1;
      }
      expect(checked).toBe(27);

      // read tools DO run for the same token
      const read = await mcpPost(
        baseUrl,
        aliceReadOnlyPat.token,
        rpcRequest(90, 'tools/call', { name: 'getSyncState', arguments: {} }),
        readOnlySession,
      );
      expect(read.message?.error).toBeUndefined();
      expect(read.message?.result?.['isError']).toBeUndefined();
      expect((read.message?.result?.['structuredContent'] as { seq: string }).seq).toBeDefined();
    });

    it('read-only PAT over REST: GET works, every mutation is a 403 problem+json', async () => {
      const get = await call(baseUrl, 'GET', '/bookmarks', { bearer: aliceReadOnlyPat.token });
      expect(get.status).toBe(200);

      const post = await call(baseUrl, 'POST', '/bookmarks', {
        bearer: aliceReadOnlyPat.token,
        body: { url: 'https://example.com/nope' },
      });
      expect(post.status).toBe(403);
      expect(problem(post).code).toBe('FORBIDDEN');
      expect(problem(post).detail).toContain('read-only');

      const put = await call(baseUrl, 'PUT', `/bookmarks/${crypto.randomUUID()}`, {
        bearer: aliceReadOnlyPat.token,
        body: { title: 'x' },
      });
      expect(put.status).toBe(403);

      // /sync/ticket is POST at REST — refused for read-only PATs (consistency
      // with the createSyncTicket tool being mutation-classified).
      const ticket = await call(baseUrl, 'POST', '/sync/ticket', {
        bearer: aliceReadOnlyPat.token,
      });
      expect(ticket.status).toBe(403);
    });

    it('PATs never reach auth, admin, or /me surfaces — even an admin’s own token', async () => {
      const adminPat = await createPat(baseUrl, admin.accessToken, 'Admin agent');
      const sessions = await call(baseUrl, 'GET', '/auth/me', { bearer: adminPat.token });
      expect(sessions.status).toBe(403);
      expect(problem(sessions).detail).toContain('auth surface');

      const tfaSetup = await call(baseUrl, 'POST', '/auth/tfa/setup', {
        bearer: alicePat.token,
      });
      expect(tfaSetup.status).toBe(403);
      expect(problem(tfaSetup).detail).toContain('auth surface');

      const adminUsers = await call(baseUrl, 'GET', '/admin/users', { bearer: adminPat.token });
      expect(adminUsers.status).toBe(403);
      expect(problem(adminUsers).detail).toContain('admin surface');

      // a plain user's read-write PAT is equally refused on /admin and /me/*
      const adminViaAlice = await call(baseUrl, 'GET', '/admin/users', { bearer: alicePat.token });
      expect(adminViaAlice.status).toBe(403);

      const listTokensViaPat = await call(baseUrl, 'GET', '/me/tokens', {
        bearer: alicePat.token,
      });
      expect(listTokensViaPat.status).toBe(403);

      const resetViaPat = await call(baseUrl, 'POST', '/me/reset-data', {
        bearer: alicePat.token,
        body: { password: 'user-password-1' },
      });
      expect(resetViaPat.status).toBe(403);

      const deleteViaPat = await call(baseUrl, 'DELETE', '/me', {
        bearer: alicePat.token,
        body: { password: 'user-password-1' },
      });
      expect(deleteViaPat.status).toBe(403);
    });

    it('PAT lifecycle: revoke → immediate 401; foreign ids are 404; revoke is idempotent', async () => {
      const doomed = await createPat(baseUrl, alice.accessToken, 'Doomed token');
      const works = await call(baseUrl, 'GET', '/bookmarks', { bearer: doomed.token });
      expect(works.status).toBe(200);

      const foreign = await call(baseUrl, 'DELETE', `/me/tokens/${doomed.id}`, {
        bearer: bob.accessToken,
      });
      expect(foreign.status).toBe(404); // user-scoped: bob cannot revoke alice's

      const first = await call(baseUrl, 'DELETE', `/me/tokens/${doomed.id}`, {
        bearer: alice.accessToken,
      });
      expect(first.status).toBe(204);
      const second = await call(baseUrl, 'DELETE', `/me/tokens/${doomed.id}`, {
        bearer: alice.accessToken,
      });
      expect(second.status).toBe(204); // idempotent

      const revoked = await call(baseUrl, 'GET', '/bookmarks', { bearer: doomed.token });
      expect(revoked.status).toBe(401);

      // the listing shows the revocation
      const list = await call<{ items: Array<{ id: string; revokedAt: string | null }> }>(
        baseUrl,
        'GET',
        '/me/tokens',
        { bearer: alice.accessToken },
      );
      expect(list.body.items.find((t) => t.id === doomed.id)?.revokedAt).not.toBeNull();
    });

    it('every tool call leaves an audit row (success and refusal alike)', async () => {
      // flush, then make exactly one successful and two failing calls
      await dataSource.query('DELETE FROM audit_log_entries');
      await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(90, 'tools/call', { name: 'getBookmarkStats', arguments: {} }),
        sessionId,
      );
      await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(91, 'tools/call', { name: 'noSuchTool', arguments: {} }),
        sessionId,
      );
      await mcpPost(
        baseUrl,
        aliceReadOnlyPat.token,
        rpcRequest(92, 'tools/call', { name: 'createBookmark', arguments: {} }),
        readOnlySession,
      );

      // audit writes are fire-and-forget — poll briefly for all three rows.
      let rows: Array<{
        actor_type: string;
        pat_id: string | null;
        action: string;
        subject: string;
        outcome: string;
      }> = [];
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        rows = (await dataSource.query(
          'SELECT actor_type, pat_id, action, subject, outcome FROM audit_log_entries ORDER BY created_at ASC, id ASC',
        )) as typeof rows;
        if (rows.length >= 3) break;
        await sleep(25);
      }
      expect(rows.length).toBe(3);
      expect(rows[0]).toMatchObject({
        actor_type: 'pat',
        action: 'mcp.tools.call',
        subject: 'getBookmarkStats',
        outcome: 'ok',
      });
      expect(rows[0]!.pat_id).toBe(alicePat.id);
      expect(rows[1]).toMatchObject({ subject: 'noSuchTool', outcome: 'error' });
      expect(rows[2]).toMatchObject({ subject: 'createBookmark', outcome: 'error' });
    });

    it('the MCP endpoint is documented with an operationId (D9 contract discipline)', async () => {
      const openapi = (await fetch(`${baseUrl}/openapi.json`).then((r) => r.json())) as {
        paths: Record<string, Record<string, { operationId?: string }>>;
      };
      const mcpPath = openapi.paths['/api/v1/mcp']!;
      expect(mcpPath).toBeDefined();
      const operation = mcpPath['post'] ?? Object.values(mcpPath)[0]!;
      expect(operation.operationId).toBe('mcpStreamableHttp');
    });

    it('M10 MCP tools: highlights CRUD, updateBookmark favorite toggle, listBookmarks favorite/type filters', async () => {
      const created = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(100, 'tools/call', {
          name: 'createBookmark',
          arguments: { url: 'https://www.youtube.com/watch?v=mcp-demo', title: 'MCP Video' },
        }),
        sessionId,
      );
      expect(created.message?.error).toBeUndefined();
      const bookmark = created.message?.result?.['structuredContent'] as {
        id: string;
        favorite: boolean;
        contentType: string;
      };
      expect(bookmark.favorite).toBe(false);
      expect(bookmark.contentType).toBe('link');

      // Toggle favorite via updateBookmark tool
      const starred = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(101, 'tools/call', {
          name: 'updateBookmark',
          arguments: { id: bookmark.id, favorite: true },
        }),
        sessionId,
      );
      expect(starred.message?.error).toBeUndefined();
      expect(
        (starred.message?.result?.['structuredContent'] as { favorite: boolean }).favorite,
      ).toBe(true);

      // Filter listBookmarks by favorite and type
      const filtered = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(102, 'tools/call', {
          name: 'listBookmarks',
          arguments: { favorite: true, type: 'link' },
        }),
        sessionId,
      );
      expect(filtered.message?.error).toBeUndefined();
      const items = (
        filtered.message?.result?.['structuredContent'] as { items: Array<{ id: string }> }
      ).items;
      expect(items.map((b) => b.id)).toContain(bookmark.id);

      const typeMismatch = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(1021, 'tools/call', {
          name: 'listBookmarks',
          arguments: { favorite: true, type: 'video' },
        }),
        sessionId,
      );
      expect(typeMismatch.message?.error).toBeUndefined();
      expect(
        (typeMismatch.message?.result?.['structuredContent'] as { items: Array<{ id: string }> })
          .items,
      ).toEqual([]);

      // Create highlight
      const hlCreate = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(103, 'tools/call', {
          name: 'createHighlight',
          arguments: {
            id: bookmark.id,
            text: 'Key MCP passage',
            note: 'Remember this',
            color: 'yellow',
          },
        }),
        sessionId,
      );
      expect(hlCreate.message?.error).toBeUndefined();
      const hl = hlCreate.message?.result?.['structuredContent'] as {
        id: string;
        text: string;
        note: string | null;
        color: string | null;
      };
      expect(hl.text).toBe('Key MCP passage');
      expect(hl.note).toBe('Remember this');
      expect(hl.color).toBe('yellow');

      // List highlights (read tool — works even with read-only PAT)
      const hlList = await mcpPost(
        baseUrl,
        aliceReadOnlyPat.token,
        rpcRequest(104, 'tools/call', {
          name: 'listHighlights',
          arguments: { id: bookmark.id },
        }),
        readOnlySession,
      );
      expect(hlList.message?.error).toBeUndefined();
      const hlItems = (
        hlList.message?.result?.['structuredContent'] as { items: Array<{ id: string }> }
      ).items;
      expect(hlItems.map((h) => h.id)).toEqual([hl.id]);

      // Update highlight
      const hlUpdate = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(105, 'tools/call', {
          name: 'updateHighlight',
          arguments: { id: hl.id, note: null, color: 'blue' },
        }),
        sessionId,
      );
      expect(hlUpdate.message?.error).toBeUndefined();
      expect(hlUpdate.message?.result?.['structuredContent']).toMatchObject({
        id: hl.id,
        note: null,
        color: 'blue',
      });

      // Delete highlight
      const hlDelete = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(106, 'tools/call', {
          name: 'deleteHighlight',
          arguments: { id: hl.id },
        }),
        sessionId,
      );
      expect(hlDelete.message?.error).toBeUndefined();
      expect(hlDelete.message?.result?.['isError']).toBeUndefined();

      const hlAfter = await mcpPost(
        baseUrl,
        aliceReadOnlyPat.token,
        rpcRequest(107, 'tools/call', {
          name: 'listHighlights',
          arguments: { id: bookmark.id },
        }),
        readOnlySession,
      );
      expect(
        (hlAfter.message?.result?.['structuredContent'] as { items: unknown[] }).items,
      ).toEqual([]);
    });

    it('M16 MCP tools: reorderCollectionBookmarks + listBookmarks sort=manual (D21)', async () => {
      const col = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(200, 'tools/call', {
          name: 'createCollection',
          arguments: { title: 'MCP Manual Sort' },
        }),
        sessionId,
      );
      const collectionId = (col.message?.result?.['structuredContent'] as { id: string }).id;

      const b1Res = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(201, 'tools/call', {
          name: 'createBookmark',
          arguments: { url: 'https://example.com/mcp-order-1', title: 'First' },
        }),
        sessionId,
      );
      const b2Res = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(202, 'tools/call', {
          name: 'createBookmark',
          arguments: { url: 'https://example.com/mcp-order-2', title: 'Second' },
        }),
        sessionId,
      );
      const b1 = (b1Res.message?.result?.['structuredContent'] as { id: string }).id;
      const b2 = (b2Res.message?.result?.['structuredContent'] as { id: string }).id;

      await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(203, 'tools/call', {
          name: 'replaceBookmarkCollections',
          arguments: { id: b1, collectionIds: [collectionId] },
        }),
        sessionId,
      );
      await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(204, 'tools/call', {
          name: 'replaceBookmarkCollections',
          arguments: { id: b2, collectionIds: [collectionId] },
        }),
        sessionId,
      );

      // Reorder via MCP tool: b2 -> 0, b1 -> 5
      const reordered = await mcpPost(
        baseUrl,
        alicePat.token,
        rpcRequest(205, 'tools/call', {
          name: 'reorderCollectionBookmarks',
          arguments: {
            id: collectionId,
            items: [
              { bookmarkId: b2, order: 0 },
              { bookmarkId: b1, order: 5 },
            ],
          },
        }),
        sessionId,
      );
      expect(reordered.message?.error).toBeUndefined();
      expect(reordered.message?.result?.['isError']).toBeUndefined();

      // List via read-only PAT with sort=manual
      const listed = await mcpPost(
        baseUrl,
        aliceReadOnlyPat.token,
        rpcRequest(206, 'tools/call', {
          name: 'listBookmarks',
          arguments: { collectionId, sort: 'manual' },
        }),
        readOnlySession,
      );
      expect(listed.message?.error).toBeUndefined();
      const items = (
        listed.message?.result?.['structuredContent'] as { items: Array<{ id: string }> }
      ).items;
      expect(items.map((item) => item.id)).toEqual([b2, b1]);
    });
  });

  describe('boot B — isolated per-PAT rate budget', () => {
    let app: INestApplication;
    let baseUrl: string;
    let dataSource: DataSource;
    let admin: AuthSession;
    let pat: { id: string; token: string };

    beforeAll(async () => {
      process.env.ARCDROP__MCP__PAT_REQUESTS_PER_MINUTE = '5';
      const boot = await bootApp();
      app = boot.app;
      baseUrl = boot.baseUrl;
      dataSource = app.get(DataSource);
      await wipeData(dataSource);
      admin = await bootstrapAdmin(baseUrl);
      pat = await createPat(baseUrl, admin.accessToken, 'Limited token');
    }, 60_000);

    afterAll(async () => {
      delete process.env.ARCDROP__MCP__PAT_REQUESTS_PER_MINUTE;
      if (app !== undefined) await app.close();
    });

    it('the 6th PAT request in the window is a 429 problem+json; JWT and other tokens are unaffected', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await call(baseUrl, 'GET', '/bookmarks', { bearer: pat.token });
        expect(res.status).toBe(200);
      }
      const sixth = await call(baseUrl, 'GET', '/bookmarks', { bearer: pat.token });
      expect(sixth.status).toBe(429);
      expect(problem(sixth).code).toBe('TOO_MANY_REQUESTS');
      expect(problem(sixth).detail).toContain('rate limit');

      // the per-IP global budget was NOT tripped: a JWT client keeps working
      const jwt = await call(baseUrl, 'GET', '/bookmarks', { bearer: admin.accessToken });
      expect(jwt.status).toBe(200);

      // a second PAT has its own budget
      const other = await createPat(baseUrl, admin.accessToken, 'Other token');
      const fresh = await call(baseUrl, 'GET', '/bookmarks', { bearer: other.token });
      expect(fresh.status).toBe(200);

      // the MCP endpoint shares the same per-token budget
      const blocked = await initialize(baseUrl, pat.token);
      expect(blocked.status).toBe(429);
    });
  });
});
