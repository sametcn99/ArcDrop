import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium, type Page } from 'playwright-core';

const origin = process.env['ARCDROP_SMOKE_URL'] ?? 'http://127.0.0.1:3000';
const mode = process.env['ARCDROP_SMOKE_MODE'] ?? 'clean';
const email = 'compose-smoke@arcdrop.test';
const password = 'arcdrop-compose-smoke-disposable-password';
const previousTitle = 'Bookmark from the previous version';

async function api<T>(path: string, method: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${origin}/api/v1${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.json() as Promise<T>;
}

async function waitForLibrary(page: Page): Promise<void> {
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  await page.locator('[data-sync-state="live"]').waitFor();
}

async function addBookmark(page: Page, title: string, slug: string): Promise<void> {
  await page.getByRole('button', { name: 'Quick add', exact: true }).click();
  const url = `https://example.com/${slug}`;
  await page.getByPlaceholder('https://example.com/article').fill(url);
  await page.getByPlaceholder('Optional title').fill(title);
  await Promise.all([
    page.waitForResponse((response) => {
      const request = response.request();
      return (
        response.status() === 201 &&
        request.url() === `${origin}/api/v1/bookmarks` &&
        request.method() === 'POST' &&
        request.postDataJSON()?.url === url
      );
    }),
    page.getByRole('button', { name: 'Save bookmark' }).click(),
  ]);
  await page.getByRole('dialog', { name: 'Quick add bookmark' }).waitFor({ state: 'hidden' });
}

async function main(): Promise<void> {
  if (mode === 'seed-upgrade') {
    const session = await api<{ accessToken: string }>('/auth/bootstrap', 'POST', {
      email,
      password,
    });
    await api(
      '/bookmarks',
      'POST',
      {
        title: previousTitle,
        url: 'https://example.com/pre-upgrade',
      },
      session.accessToken,
    );
    return;
  }

  const browser = await chromium.launch({ executablePath: process.env['ARCDROP_CHROMIUM_PATH'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const first = await context.newPage();
    const isUpgrade = mode === 'upgrade';
    const authPath = isUpgrade ? 'login' : 'bootstrap';
    await first.goto(`${origin}/${authPath}`);
    await first.getByLabel(isUpgrade ? /^Email/ : /^Admin email/).fill(email);
    await first.getByLabel(/^Password/).fill(password);
    if (!isUpgrade) await first.getByLabel(/^Confirm password/).fill(password);
    const [signedIn] = await Promise.all([
      first.waitForResponse((response) => response.url().endsWith(`/auth/${authPath}`)),
      first.getByRole('button', { name: isUpgrade ? 'Sign in' : 'Create admin account' }).click(),
    ]);
    assert.ok(signedIn.ok());
    const { accessToken } = (await signedIn.json()) as { accessToken: string };
    await waitForLibrary(first);
    if (isUpgrade) await first.getByText(previousTitle, { exact: true }).waitFor();

    await first.evaluate(() => document.fonts.ready);
    assert.ok(
      await first.evaluate(() =>
        [...document.fonts].some(
          (font) => font.family.includes('Onest') && font.status === 'loaded',
        ),
      ),
    );

    const collection = await api<{ id: string }>(
      '/collections',
      'POST',
      { title: 'Smoke Share' },
      accessToken,
    );
    const shared = await api<{ shareToken: string }>(
      `/collections/${collection.id}/share`,
      'PUT',
      { enabled: true },
      accessToken,
    );
    const guest = await browser.newPage();
    await guest.goto(`${origin}/s/${shared.shareToken}`);
    await guest.getByText('Smoke Share', { exact: true }).first().waitFor();
    await guest.close();
    const sharePath = `/api/v1/public/collections/${shared.shareToken}`;
    if (process.env['ARCDROP_SMOKE_SHARE_PATH_FILE']) {
      await Bun.write(process.env['ARCDROP_SMOKE_SHARE_PATH_FILE'], sharePath);
    }
    const publicOrigin = process.env['ARCDROP_SMOKE_PUBLIC_ORIGIN'];
    if (publicOrigin) {
      const rss = await fetch(`${origin}${sharePath}/rss`);
      assert.ok(rss.ok);
      assert.ok((await rss.text()).includes(`${publicOrigin}${sharePath}/rss`));
    }

    const second = await context.newPage();
    const refreshInputs: string[] = [];
    const refreshStatuses: number[] = [];
    context.on('response', (response) => {
      if (response.url().endsWith('/auth/refresh')) refreshStatuses.push(response.status());
    });
    await context.route('**/api/v1/auth/refresh', async (route) => {
      const { refreshToken } = route.request().postDataJSON() as { refreshToken: string };
      refreshInputs.push(refreshToken);
      await pause(120);
      await route.continue();
    });
    await Promise.all([first.reload(), second.goto(origin)]);
    try {
      await Promise.all([waitForLibrary(first), waitForLibrary(second)]);
    } catch (error) {
      const pages = await Promise.all(
        [first, second].map(async (page) => ({
          path: new URL(page.url()).pathname,
          heading: await page.getByRole('heading').allTextContents(),
        })),
      );
      throw new Error(
        JSON.stringify({
          pages,
          refreshCount: refreshInputs.length,
          uniqueRefreshCount: new Set(refreshInputs).size,
          refreshStatuses,
        }),
        { cause: error },
      );
    }
    assert.deepEqual(refreshStatuses, [201, 201]);
    assert.equal(refreshInputs.length, 2);
    assert.equal(new Set(refreshInputs).size, 2);

    await addBookmark(first, 'Synced from another tab', 'synced');
    await second.getByText('Synced from another tab', { exact: true }).first().waitFor();

    let attempts = 0;
    for (const page of [first, second]) {
      let firstPost = true;
      await page.route('**/api/v1/bookmarks', async (route) => {
        if (firstPost && route.request().method() === 'POST') {
          firstPost = false;
          attempts++;
          // Model expiry once per tab. Refresh and retried mutations hit the real server.
          await route.fulfill({ status: 401, json: { message: 'Access token expired' } });
        } else {
          await route.continue();
        }
      });
    }
    await Promise.all([
      addBookmark(first, 'First refresh retry', 'first-retry'),
      addBookmark(second, 'Second refresh retry', 'second-retry'),
    ]);
    assert.equal(attempts, 2);
    assert.equal(refreshInputs.length, 4);
    assert.equal(new Set(refreshInputs).size, 4);

    await first.getByRole('button', { name: 'Sign out' }).click();
    await Promise.all([first.waitForURL('**/login'), second.waitForURL('**/login')]);
    console.log(
      'Web setup, sharing, WebSocket sync, concurrent refresh and cross-tab logout passed.',
    );
  } finally {
    await browser.close();
  }
}

await main();
