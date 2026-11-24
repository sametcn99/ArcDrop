import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';

const directory = resolve('extension/dist/chromium');
const profile = await mkdtemp(join(tmpdir(), 'arcdrop-extension-'));
try {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    executablePath: process.env['ARCDROP_CHROMIUM_PATH'],
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const origin =
      new URL(worker.url()).origin === 'null'
        ? worker.url().split('/').slice(0, 3).join('/')
        : new URL(worker.url()).origin;
    const page = await context.newPage();
    const outgoing: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) outgoing.push(request.url());
    });
    await page.goto(`${origin}/pages/app/index.html`);
    await page.getByRole('heading', { name: 'Connect to your server' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.ok(
      await page.evaluate(() =>
        [...document.fonts].some(
          (font) => font.family.includes('Onest') && font.status === 'loaded',
        ),
      ),
    );
    assert.deepEqual(outgoing, []);
    console.log('Chromium loaded the ArcDrop extension, embedded UI and local font.');
  } finally {
    await context.close();
  }
} finally {
  await rm(profile, { recursive: true, force: true });
}
