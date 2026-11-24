import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDataSource } from '../src/database/data-source';
import { loadConfig } from '../src/config/load-config';

const config = loadConfig();
const databaseName = new URL(config.database.url).pathname;
assert.ok(
  databaseName.endsWith('_bench'),
  'Use an empty, disposable database with an _bench suffix',
);
const origin = process.env['ARCDROP_BENCH_URL'] ?? 'http://127.0.0.1:3000';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Use a localhost API');
const apiPid = Number(process.env['ARCDROP_BENCH_PID']);
assert.ok(Number.isInteger(apiPid) && apiPid > 0, 'Set ARCDROP_BENCH_PID to the API process PID');
const email = 'benchmark@arcdrop.test';
const password = 'arcdrop-disposable-benchmark-password';
let token: string | undefined;

async function request(path: string, method = 'GET', input?: object): Promise<Response> {
  const form = input instanceof FormData;
  const result = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(input && !form ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form ? input : input ? JSON.stringify(input) : undefined,
  });
  if (!result.ok)
    throw new Error(`${method} ${path}: HTTP ${result.status} ${await result.text()}`);
  return result;
}

async function rssMiB(): Promise<number> {
  const stat = await readFile(`/proc/${apiPid}/status`, 'utf8');
  const match = /^VmRSS:\s+(\d+) kB/m.exec(stat);
  if (!match) throw new Error('Could not read the API process RSS');
  return Number(match[1]) / 1024;
}

async function measureRss<T>(label: string, perform: () => Promise<T>): Promise<T> {
  const start = await rssMiB();
  let peak = start;
  let pending: Promise<number> | undefined;
  const sampler = setInterval(() => {
    pending ??= rssMiB()
      .then((value) => {
        peak = Math.max(peak, value);
        return value;
      })
      .finally(() => {
        pending = undefined;
      });
  }, 20);
  try {
    return await perform();
  } finally {
    clearInterval(sampler);
    await pending;
    peak = Math.max(peak, await rssMiB());
    console.log(`${label}: start ${start.toFixed(1)} MiB, peak ${peak.toFixed(1)} MiB`);
  }
}

const database = await createDataSource(config).initialize();
try {
  const [existing] = (await database.query('SELECT count(*)::int AS count FROM users')) as Array<{
    count: number;
  }>;
  assert.equal(existing?.count, 0, 'Start with an empty, migrated benchmark instance');

  const boot = await request('/auth/bootstrap', 'POST', { email, password });
  const session = (await boot.json()) as { accessToken: string; user: { id: string } };
  token = session.accessToken;
  let previous = 0;
  for (const count of [10_000, 50_000]) {
    await database.query(
      `INSERT INTO bookmarks (user_id, url, title, host, scheme, content_type, cache_status, archive_text)
       SELECT $1, 'https://example.com/fixture/' || n, 'Fixture ' || n, 'example.com', 'https',
              'article', 'ready',
              CASE WHEN n % 100 = 0 THEN 'concurrency needle guide with a short body'
                   ELSE 'synthetic archived library content for comparison' END
       FROM generate_series($2::int, $3::int) n`,
      [session.user.id, previous + 1, count],
    );
    previous = count;
    await database.query('ANALYZE bookmarks');

    const samples: number[] = [];
    for (let attempt = 0; attempt < 24; attempt++) {
      const start = performance.now();
      const response = await request('/bookmarks?search=concurrency+needle&pageSize=25');
      const data = (await response.json()) as { totalCount: number; items: unknown[] };
      assert.equal(data.totalCount, count / 100);
      assert.equal(data.items.length, 25);
      if (attempt >= 4) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(
      `${count} bookmarks: search p50 ${samples[9]!.toFixed(1)} ms, p95 ${samples[18]!.toFixed(1)} ms`,
    );
  }

  const collection = (await (
    await request('/collections', 'POST', { title: 'ZIP benchmark' })
  ).json()) as { id: string };
  for (const name of ['fixture-a.png', 'fixture-b.png']) {
    const form = new FormData();
    form.append('file', new Blob([randomBytes(16 * 1024 * 1024)], { type: 'image/png' }), name);
    form.append('collectionIds', collection.id);
    await (await request('/bookmarks/file', 'POST', form)).json();
  }
  const zip = await measureRss('ZIP export (two 16 MiB attachments)', async () =>
    (
      await request('/data/export', 'POST', {
        format: 'json',
        includeFiles: true,
        collectionId: collection.id,
      })
    ).blob(),
  );
  const form = new FormData();
  form.append('file', zip, 'benchmark.zip');
  await measureRss('ZIP import (two 16 MiB attachments)', async () => {
    const summary = (await (await request('/data/import', 'POST', form)).json()) as {
      created: number;
      updated: number;
      errors: unknown[];
    };
    assert.equal(summary.created, 0);
    assert.equal(summary.updated, 2);
    assert.deepEqual(summary.errors, []);
  });
} finally {
  await database.destroy();
}
