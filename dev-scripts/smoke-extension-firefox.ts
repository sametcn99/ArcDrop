import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
const port = probe.port;
await probe.stop(true);
// This fresh, loopback-only session opens a packaged extension page through
// Firefox's UI automation context. Web content cannot navigate to that origin.
const driver = Bun.spawn(
  [
    process.env['ARCDROP_GECKODRIVER_PATH'] ?? 'geckodriver',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--allow-system-access',
  ],
  { stdout: 'ignore', stderr: 'inherit' },
);
const baseUrl = `http://127.0.0.1:${port}`;
const extensionId = 'arcdrop@arcdrop.dev';
const uuid = '9379b668-de51-4a84-86b0-2507b9568e6b';
let session: string | undefined;

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as { value: T };
  assert.ok(response.ok, JSON.stringify(data));
  return data.value;
}

try {
  for (let attempt = 0; ; attempt++) {
    assert.equal(driver.exitCode, null, 'GeckoDriver exited before opening a session');
    try {
      await request('/status');
      break;
    } catch (error) {
      if (attempt >= 40) throw error;
      await pause(100);
    }
  }

  const started = await request<{ sessionId: string }>('/session', 'POST', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          ...(process.env['ARCDROP_FIREFOX_PATH']
            ? { binary: process.env['ARCDROP_FIREFOX_PATH'] }
            : {}),
          args: ['-headless'],
          prefs: { 'extensions.webextensions.uuids': JSON.stringify({ [extensionId]: uuid }) },
        },
      },
    },
  });
  session = `/session/${started.sessionId}`;
  const installedId = await request<string>(`${session}/moz/addon/install`, 'POST', {
    path: resolve('extension/dist/arcdrop-extension-firefox.zip'),
    temporary: true,
  });
  assert.equal(installedId, extensionId);
  await request(`${session}/moz/context`, 'POST', { context: 'chrome' });
  await request(`${session}/execute/sync`, 'POST', {
    script: `gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });`,
    args: [`moz-extension://${uuid}/pages/app/index.html`],
  });
  await request(`${session}/moz/context`, 'POST', { context: 'content' });
  for (let attempt = 0; ; attempt++) {
    const ready = await request<boolean>(`${session}/execute/sync`, 'POST', {
      script: `return document.body.innerText.includes('Connect to your server') &&
        [...document.fonts].some(font => font.family.includes('Onest') && font.status === 'loaded');`,
      args: [],
    });
    if (ready) break;
    assert.ok(attempt < 60, 'Firefox did not load the embedded app and its local font');
    await pause(200);
  }
  console.log('Firefox loaded the ArcDrop extension, embedded UI and local font.');
} finally {
  try {
    if (session) await request(session, 'DELETE');
  } finally {
    driver.kill();
    await driver.exited;
  }
}
