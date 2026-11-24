import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { origin } from './fixtures';

export interface Driver {
  visit(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  setViewport(width: number, height: number): Promise<void>;
  evaluate<T>(script: string, ...args: unknown[]): Promise<T>;
  screenshot(path: string, fullPage?: boolean): Promise<void>;
  close(): Promise<void>;
}

export async function until<T>(description: string, check: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 25_000;
  let lastError: unknown;
  do {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await pause(200);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`, { cause: lastError });
}

export async function openChromium(mobile: boolean, extension?: string) {
  const profile = await mkdtemp(resolve(tmpdir(), 'arcdrop-chromium-'));
  const context = await chromium
    .launchPersistentContext(profile, {
      channel: 'chromium',
      executablePath: process.env['ARCDROP_CHROMIUM_PATH'],
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      ...(mobile ? { isMobile: true, hasTouch: true } : {}),
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
      args: extension
        ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
        : [],
    })
    .catch(async (error: unknown) => {
      await rm(profile, { recursive: true, force: true });
      throw error;
    });
  const page = context.pages()[0] ?? (await context.newPage());
  const driver: Driver = {
    async visit(url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    },
    click: (selector) => page.locator(selector).click(),
    setViewport: (width, height) => page.setViewportSize({ width, height }),
    evaluate: (script, ...args) =>
      page.evaluate(`(function () { ${script} })(...${JSON.stringify(args)})`),
    async screenshot(path, fullPage = true) {
      await page.screenshot({ path, fullPage, animations: 'disabled' });
    },
    async close() {
      try {
        await context.close();
      } finally {
        await rm(profile, { recursive: true, force: true });
      }
    },
  };
  return { driver, context, page };
}

async function openWebDriver(endpoint: string, capabilities: Record<string, unknown>) {
  async function send<T>(
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    const response = await fetch(endpoint + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await response.json()) as { value: T };
    assert.ok(response.ok, `${method} ${path}: ${JSON.stringify(data.value)}`);
    return data.value;
  }

  await until(`WebDriver at ${endpoint}`, () => send('/status'));
  const { sessionId } = await send<{ sessionId: string }>('/session', {
    capabilities: { alwaysMatch: capabilities },
  });
  assert.ok(sessionId, 'WebDriver did not return a session');
  const request = <T>(path: string, body?: unknown, method?: string) =>
    send<T>(`/session/${sessionId}${path}`, body, method);
  const driver: Driver = {
    async visit(url) {
      await request('/url', { url });
    },
    async click(selector) {
      const key = 'element-6066-11e4-a52e-4f735466cecf';
      const element = await request<Record<string, string>>('/element', {
        using: 'css selector',
        value: selector,
      });
      await request(`/element/${element[key]}/click`, {});
    },
    async setViewport(width, height) {
      await request('/window/rect', { width, height });
    },
    evaluate: (script, ...args) => request('/execute/sync', { script, args }),
    async screenshot(path) {
      const png = await request<string>('/screenshot');
      await Bun.write(path, Buffer.from(png, 'base64'));
    },
    async close() {
      await request('', undefined, 'DELETE');
    },
  };
  return { driver, request };
}

export async function openNative(): Promise<Driver> {
  const { driver } = await openWebDriver('http://127.0.0.1:4445', {});
  return {
    ...driver,
    async visit(path) {
      await driver.evaluate(
        `history.pushState(null, '', arguments[0]); dispatchEvent(new PopStateEvent('popstate'));`,
        path,
      );
    },
  };
}

export async function openFirefox(
  archive: string,
): Promise<{ driver: Driver; extensionUrl: string }> {
  const socket = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = socket.port;
  await socket.stop(true);
  const gecko = Bun.spawn(
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
  const extensionId = 'arcdrop@arcdrop.dev';
  const uuid = '9379b668-de51-4a84-86b0-2507b9568e6b';
  try {
    const { driver, request } = await openWebDriver(`http://127.0.0.1:${port}`, {
      browserName: 'firefox',
      'moz:firefoxOptions': {
        binary: process.env['ARCDROP_FIREFOX_PATH'],
        args: ['-headless', '--width=1440', '--height=1050'],
        prefs: {
          'extensions.webextensions.uuids': JSON.stringify({ [extensionId]: uuid }),
          'layout.css.prefers-color-scheme.content-override': 1,
        },
      },
    });
    const installed = await request('/moz/addon/install', { path: archive, temporary: true });
    assert.equal(installed, extensionId);
    return {
      extensionUrl: `moz-extension://${uuid}`,
      driver: {
        ...driver,
        async visit(url) {
          if (!url.startsWith('moz-extension:')) {
            await driver.visit(url);
            return;
          }
          await request('/moz/context', { context: 'chrome' });
          try {
            await driver.evaluate(
              `gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
            });`,
              url,
            );
          } finally {
            await request('/moz/context', { context: 'content' });
          }
          await until(url, () =>
            driver.evaluate(
              `return location.href === arguments[0] && document.readyState !== 'loading';`,
              url,
            ),
          );
        },
        async close() {
          try {
            await driver.close();
          } finally {
            gecko.kill();
            await gecko.exited;
          }
        },
      },
    };
  } catch (error) {
    gecko.kill();
    await gecko.exited;
    throw error;
  }
}

export async function startFixtures() {
  const server = Bun.spawn([process.execPath, resolve(import.meta.dir, 'server.ts')], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  try {
    await until('the screenshot fixture server', async () => {
      assert.equal(server.exitCode, null, 'Fixture server exited during startup');
      return (await fetch(`${origin}/openapi.json`)).ok;
    });
    return server;
  } catch (error) {
    server.kill();
    await server.exited;
    throw error;
  }
}
