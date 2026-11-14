/**
 * M9 scripted smoke-load & rate-limit verification against a live ArcDrop API
 * instance (intended to run against a freshly migrated DB, e.g. `bun dist/main.js`).
 *
 * Verifies:
 *   1. Health/readiness + correlation ID (`x-request-id`) threading on 2xx & errors
 *   2. Strict auth throttle: 10/min per IP on `POST /api/v1/auth/login`
 *   3. Per-user expensive-route budget: 30/min on `POST /api/v1/bookmarks/:id/reindex`
 *   4. Global per-IP throttle: 100/min per handler on `GET /api/v1/bookmarks`
 *   5. Shared PAT budget: 300/min across REST + MCP endpoints
 *   6. JSON body limit revisit: >256 KB on REST -> 413 `application/problem+json`
 *
 * Usage:
 *   ARCDROP_SMOKE_URL=http://127.0.0.1:3000 bun run load:smoke
 */

const BASE_URL = (process.env['ARCDROP_SMOKE_URL'] ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const ADMIN_EMAIL = process.env['ARCDROP_SMOKE_EMAIL'] ?? 'load-smoke@arcdrop.test';
const ADMIN_PASSWORD = process.env['ARCDROP_SMOKE_PASSWORD'] ?? 'load-smoke-password-1';

interface BucketStats {
  label: string;
  total: number;
  statusCounts: Record<number, number>;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  avgMs: number;
}

function summarize(label: string, results: Array<{ status: number; ms: number }>): BucketStats {
  const statusCounts: Record<number, number> = {};
  for (const r of results) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }
  const sorted = [...results.map((r) => r.ms)].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const pct = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return {
    label,
    total: results.length,
    statusCounts,
    p50Ms: Number(pct(0.5).toFixed(2)),
    p95Ms: Number(pct(0.95).toFixed(2)),
    maxMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    avgMs: Number((sum / Math.max(1, sorted.length)).toFixed(2)),
  };
}

async function timedFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; ms: number; res: Response }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE_URL}${path}`, init);
  const ms = performance.now() - t0;
  return { status: res.status, ms, res };
}

async function runBatched<T>(
  count: number,
  concurrency: number,
  fn: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array(count);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= count) return;
      results[idx] = await fn(idx);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Load smoke assertion failed: ${message}`);
  }
}

async function main(): Promise<void> {
  const tStart = performance.now();

  // 1. Health + readiness + correlation ID echo
  const healthCorrelation = `smoke-health-${Date.now()}`;
  const health = await timedFetch('/api/v1/healthz', {
    headers: { 'x-request-id': healthCorrelation },
  });
  assert(health.status === 200, `expected 200 on /healthz, got ${health.status}`);
  assert(
    health.res.headers.get('x-request-id') === healthCorrelation,
    'x-request-id was not echoed on /healthz',
  );

  const ready = await timedFetch('/api/v1/readyz');
  assert(ready.status === 200, `expected 200 on /readyz, got ${ready.status}`);

  // 2. Bootstrap or login admin
  let accessToken = '';
  const boot = await timedFetch('/api/v1/auth/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (boot.status === 201) {
    const body = (await boot.res.json()) as { accessToken: string };
    accessToken = body.accessToken;
  } else {
    const login = await timedFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    assert(login.status === 201, `expected bootstrap (201) or login (201), got ${login.status}`);
    const body = (await login.res.json()) as { accessToken: string };
    accessToken = body.accessToken;
  }

  // Provision bookmark + PAT + MCP session
  const bmRes = await timedFetch('/api/v1/bookmarks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ url: 'https://arcdrop.dev/load-smoke', title: 'Load Smoke' }),
  });
  assert(bmRes.status === 201, `expected bookmark 201, got ${bmRes.status}`);
  const bookmarkId = ((await bmRes.res.json()) as { id: string }).id;

  const patRes = await timedFetch('/api/v1/me/tokens', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name: `load-smoke-${Date.now()}` }),
  });
  assert(patRes.status === 201, `expected PAT 201, got ${patRes.status}`);
  const pat = ((await patRes.res.json()) as { token: string }).token;

  const mcpInit = await timedFetch('/api/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'load-smoke', version: '0.1.0' },
      },
    }),
  });
  assert(mcpInit.status === 200, `expected MCP initialize 200, got ${mcpInit.status}`);
  const mcpSessionId = mcpInit.res.headers.get('mcp-session-id');
  assert(Boolean(mcpSessionId), 'missing Mcp-Session-Id from initialize');

  const stats: BucketStats[] = [];

  // 3. Strict auth limit (10/min per IP on POST /auth/login)
  const authResults = await runBatched(12, 1, async (idx) => {
    const corr = `smoke-auth-${idx}`;
    const r = await timedFetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': corr },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong-password-123' }),
    });
    if (r.status === 429 || r.status === 401) {
      const problem = (await r.res.json()) as { requestId?: string; code?: string };
      assert(r.res.headers.get('x-request-id') === corr, `missing echoed x-request-id on ${corr}`);
      assert(problem.requestId === corr, `missing problem.requestId on ${corr}`);
    }
    return { status: r.status, ms: r.ms };
  });
  const authSummary = summarize('strict-auth (POST /auth/login, 10/min IP)', authResults);
  stats.push(authSummary);
  assert(
    (authSummary.statusCounts[401] ?? 0) === 10 && (authSummary.statusCounts[429] ?? 0) === 2,
    `expected 10x401 + 2x429 on auth, got ${JSON.stringify(authSummary.statusCounts)}`,
  );

  // 4. Per-user reindex limit (30/min on POST /bookmarks/:id/reindex)
  const reindexResults = await runBatched(32, 4, async (idx) => {
    const corr = `smoke-reindex-${idx}`;
    const r = await timedFetch(`/api/v1/bookmarks/${bookmarkId}/reindex`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'x-request-id': corr },
    });
    if (r.status === 429) {
      const p = (await r.res.json()) as { code?: string; requestId?: string };
      assert(p.code === 'TOO_MANY_REQUESTS', `expected TOO_MANY_REQUESTS, got ${p.code}`);
      assert(p.requestId === corr, 'correlation mismatch on reindex 429');
    }
    return { status: r.status, ms: r.ms };
  });
  const reindexSummary = summarize(
    'per-user-reindex (POST /bookmarks/:id/reindex, 30/min)',
    reindexResults,
  );
  stats.push(reindexSummary);
  assert(
    (reindexSummary.statusCounts[202] ?? 0) === 30 && (reindexSummary.statusCounts[429] ?? 0) === 2,
    `expected 30x202 + 2x429 on reindex, got ${JSON.stringify(reindexSummary.statusCounts)}`,
  );

  // 5. Global per-IP limit (100/min per handler on GET /bookmarks)
  const globalIpResults = await runBatched(105, 10, async (idx) => {
    const corr = `smoke-global-${idx}`;
    const r = await timedFetch('/api/v1/bookmarks', {
      headers: { authorization: `Bearer ${accessToken}`, 'x-request-id': corr },
    });
    if (r.status === 429) {
      const p = (await r.res.json()) as { code?: string; requestId?: string };
      assert(p.code === 'TOO_MANY_REQUESTS', 'expected TOO_MANY_REQUESTS on global 429');
      assert(p.requestId === corr, 'correlation mismatch on global 429');
    }
    return { status: r.status, ms: r.ms };
  });
  const globalSummary = summarize('global-per-ip (GET /bookmarks, 100/min)', globalIpResults);
  stats.push(globalSummary);
  assert(
    (globalSummary.statusCounts[200] ?? 0) === 100 && (globalSummary.statusCounts[429] ?? 0) === 5,
    `expected 100x200 + 5x429 on global IP, got ${JSON.stringify(globalSummary.statusCounts)}`,
  );

  // 6. Per-PAT shared limit (300/min across REST + MCP).
  // Remember `initialize` above consumed 1 PAT request, leaving 299 in the window.
  // Spread 304 calls across 4 handlers (<100/min each) so per-IP never trips first:
  //   90 GET /collections + 90 GET /sync/state + 90 GET /bookmarks/stats + 34 MCP tools/call = 304.
  const patRequests: Array<() => Promise<{ status: number; ms: number }>> = [
    ...Array.from({ length: 90 }, () => async () => {
      const r = await timedFetch('/api/v1/collections', {
        headers: { authorization: `Bearer ${pat}` },
      });
      return { status: r.status, ms: r.ms };
    }),
    ...Array.from({ length: 90 }, () => async () => {
      const r = await timedFetch('/api/v1/sync/state', {
        headers: { authorization: `Bearer ${pat}` },
      });
      return { status: r.status, ms: r.ms };
    }),
    ...Array.from({ length: 90 }, () => async () => {
      const r = await timedFetch('/api/v1/bookmarks/stats', {
        headers: { authorization: `Bearer ${pat}` },
      });
      return { status: r.status, ms: r.ms };
    }),
    ...Array.from({ length: 34 }, (_, i) => async () => {
      const r = await timedFetch('/api/v1/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${pat}`,
          'mcp-session-id': mcpSessionId!,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 100 + i,
          method: 'tools/call',
          params: { name: 'getBookmarkStats', arguments: {} },
        }),
      });
      return { status: r.status, ms: r.ms };
    }),
  ];
  const patResults = await runBatched(patRequests.length, 10, (idx) => patRequests[idx]!());
  const patSummary = summarize('pat-shared-rest-and-mcp (300/min incl. 1 initialize)', patResults);
  stats.push(patSummary);
  assert(
    (patSummary.statusCounts[200] ?? 0) === 299 && (patSummary.statusCounts[429] ?? 0) === 5,
    `expected 299x200 + 5x429 on PAT (plus 1 initialize = 300), got ${JSON.stringify(patSummary.statusCounts)}`,
  );

  // 7. Revisit #2: REST 256 KB JSON cap with correlation ID end-to-end
  const oversizeCorr = `smoke-413-${Date.now()}`;
  const oversize = await timedFetch('/api/v1/bookmarks', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'x-request-id': oversizeCorr,
    },
    body: JSON.stringify({ url: 'https://example.com/big', notes: 'a'.repeat(300 * 1024) }),
  });
  assert(oversize.status === 413, `expected 413 on >256KB REST JSON, got ${oversize.status}`);
  const oversizeBody = (await oversize.res.json()) as { code: string; requestId?: string };
  assert(
    oversizeBody.code === 'PAYLOAD_TOO_LARGE',
    `expected PAYLOAD_TOO_LARGE, got ${oversizeBody.code}`,
  );
  assert(oversizeBody.requestId === oversizeCorr, 'correlation mismatch on 413 problem+json');

  const totalDurationMs = Number((performance.now() - tStart).toFixed(1));
  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        totalDurationMs,
        totalRequests: stats.reduce((acc, s) => acc + s.total, 0) + 7, // + healthz,readyz,bootstrap,bookmark,pat,mcpInit,413
        buckets: stats,
        bodyLimitCheck: { status: 413, code: oversizeBody.code, requestId: oversizeBody.requestId },
      },
      null,
      2,
    ),
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
