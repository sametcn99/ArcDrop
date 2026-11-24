import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { accountPages, guestPages, targets, type Screenshot } from './catalog';
import { openChromium, openFirefox, openNative, startFixtures, until, type Driver } from './driver';
import { demoPassword, origin, totpEmail } from './fixtures';

const target = targets.find((value) => value === process.argv[2]);
assert.ok(target, `Specify a screenshot target: ${targets.join(', ')}`);
const output = resolve(process.argv[3] ?? 'screenshot-output', target);
await mkdir(output, { recursive: true });

async function visible(driver: Driver, label: string) {
  try {
    await until(label, () =>
      driver.evaluate(
        'return document.body?.innerText.toLowerCase().includes(arguments[0].toLowerCase());',
        label,
      ),
    );
  } catch (error) {
    const page = await driver
      .evaluate('return location.href + "\\n" + document.body?.innerText.slice(0, 1200);')
      .catch(() => '(page unavailable)');
    throw new Error(`Expected "${label}" in ${page}`, { cause: error });
  }
}

async function click(driver: Driver, role: 'tab' | 'button', label: string, trusted = false) {
  await until(`${role} "${label}"`, () =>
    driver.evaluate(
      `
    const [role, label, trusted] = arguments;
    const selector = role === 'tab' ? '[role="tab"]' : 'button';
    const control = [...document.querySelectorAll(selector)].find((element) => {
      const text = element.textContent.trim();
      const matches = text === label || (role === 'tab' && text.startsWith(label + ' ('));
      return matches && !element.disabled && element.getClientRects().length;
    });
    if (!control) return false;
    if (trusted) control.dataset.screenshotClick = 'true';
    else control.click();
    return true;`,
      role,
      label,
      trusted,
    ),
  );
  if (trusted) await driver.click('[data-screenshot-click="true"]');
}

async function fill(driver: Driver, selector: string, value: string) {
  await until(selector, () =>
    driver.evaluate(
      `
    const input = document.querySelector(arguments[0]);
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    if (!input || input.disabled) return false;
    setValue.call(input, arguments[1]);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;`,
      selector,
      value,
    ),
  );
}

async function shot(driver: Driver, name: string, fullPage = true) {
  await until('fonts, images and animations to settle', () =>
    driver.evaluate(`
    return (!document.fonts || document.fonts.status === 'loaded') &&
      !document.getAnimations?.().some((animation) => animation.playState === 'running' &&
        Number.isFinite(animation.effect?.getComputedTiming().endTime));
  `),
  );
  const path = resolve(output, `${name}.png`);
  if (target === 'android-emulator') {
    const capture = Bun.spawn(['adb', 'exec-out', 'screencap', '-p'], { stdout: 'pipe' });
    await Bun.write(path, new Uint8Array(await new Response(capture.stdout).arrayBuffer()));
    assert.equal(await capture.exited, 0);
  } else if (target === 'ios-simulator') {
    assert.equal(
      await Bun.spawn(['xcrun', 'simctl', 'io', 'booted', 'screenshot', path]).exited,
      0,
    );
  } else {
    await driver.screenshot(path, fullPage);
  }
  console.log(`${target}/${name}.png`);
}

async function pageShot(driver: Driver, page: Screenshot, base: string) {
  await driver.visit(base + page.path);
  if (page.tab) await click(driver, 'tab', page.tab);
  await visible(driver, page.text);
  if (page.selector) {
    await until(page.selector, () =>
      driver.evaluate('return Boolean(document.querySelector(arguments[0]));', page.selector),
    );
  }
  await shot(driver, page.name);
}

async function login(driver: Driver, popup: boolean, captureName: string) {
  await fill(driver, 'input[type=email]', totpEmail);
  await fill(driver, 'input[type=password]', demoPassword);
  await click(driver, 'button', 'Sign in');
  await visible(driver, 'Two-factor authentication');
  await shot(driver, captureName, !popup);
  await fill(
    driver,
    popup ? 'input' : 'input[autocomplete=one-time-code], input[inputmode=numeric]',
    '123456',
  );
  await click(driver, 'button', popup ? 'Verify' : 'Verify and sign in');
}

async function captureApp(driver: Driver, base: string, beforeAccount?: () => Promise<void>) {
  for (const page of guestPages) await pageShot(driver, page, base);
  await driver.visit(`${base}/login`);
  await visible(driver, 'Access your ArcDrop bookmark library.');
  await login(driver, false, 'login-two-factor');
  await visible(driver, 'ArcDrop Architecture Guide');
  await beforeAccount?.();
  for (const page of accountPages) await pageShot(driver, page, base);
}

async function captureExtension(
  driver: Driver,
  base: string,
  popupPath: string,
  optionsPath: string,
) {
  const popup = `${base}/${popupPath}`;
  const options = `${base}/${optionsPath}`;
  const app = `${base}/pages/app/index.html#`;
  await driver.visit(popup);
  await visible(driver, 'Connect your server');
  await shot(driver, 'extension-popup-setup', false);
  await fill(driver, 'input', origin);
  await click(driver, 'button', 'Continue', true);
  await visible(driver, 'Use your ArcDrop account credentials.');
  await shot(driver, 'extension-popup-login', false);

  await captureApp(driver, app, async () => {
    await driver.visit(popup);
    await visible(driver, 'Use your ArcDrop account credentials.');
    await login(driver, true, 'extension-popup-two-factor');
    await visible(driver, 'Quick save');
    await shot(driver, 'extension-popup-editor', false);
    await click(driver, 'button', 'Save all tabs');
    await visible(driver, 'savable tab(s) found.');
    await shot(driver, 'extension-popup-save-all-tabs', false);
    await driver.visit(options);
    await visible(driver, 'Manage sessions in ArcDrop');
    await shot(driver, 'extension-options');
  });
}

const fixtures = await startFixtures();
let driver: Driver | undefined;
let desktop: ReturnType<typeof Bun.spawn> | undefined;
try {
  if (target === 'api-reference') {
    ({ driver } = await openChromium(false));
    const api = 'http://127.0.0.1:4180';
    await until('ArcDrop API docs server', async () => (await fetch(`${api}/openapi.json`)).ok);
    await driver.visit(`${api}/docs`);
    await visible(driver, 'ArcDrop API');
    await shot(driver, 'api-reference', false);
  } else if (target === 'web-desktop' || target === 'web-mobile') {
    ({ driver } = await openChromium(target === 'web-mobile'));
    await captureApp(driver, origin);
  } else if (target === 'extension-chromium' || target === 'extension-firefox') {
    const browser = target === 'extension-chromium' ? 'chromium' : 'firefox';
    const folder = resolve('extension/dist', browser);
    const manifest = (await Bun.file(resolve(folder, 'manifest.json')).json()) as {
      action: { default_popup: string };
      options_ui: { page: string };
    };
    if (browser === 'chromium') {
      const chrome = await openChromium(false, folder);
      driver = chrome.driver;
      const worker =
        chrome.context.serviceWorkers()[0] ?? (await chrome.context.waitForEvent('serviceworker'));
      const extensionUrl = `chrome-extension://${new URL(worker.url()).host}`;
      await captureExtension(
        driver,
        extensionUrl,
        manifest.action.default_popup,
        manifest.options_ui.page,
      );
    } else {
      const firefox = await openFirefox(resolve('extension/dist/arcdrop-extension-firefox.zip'));
      driver = firefox.driver;
      await captureExtension(
        driver,
        firefox.extensionUrl,
        manifest.action.default_popup,
        manifest.options_ui.page,
      );
    }
  } else {
    if (target?.startsWith('desktop-')) {
      const name = process.platform === 'win32' ? 'arcdrop.exe' : 'arcdrop';
      desktop = Bun.spawn([resolve('cross-platform/src-tauri/target/debug', name)], {
        stdout: 'inherit',
        stderr: 'inherit',
      });
    }
    driver = await Promise.race([
      openNative(),
      ...(desktop
        ? [
            desktop.exited.then((code) => {
              throw new Error(`ArcDrop exited before opening WebDriver (exit ${code})`);
            }),
          ]
        : []),
    ]);
    await until('ArcDrop WebView', () =>
      driver!.evaluate('return Boolean(document.querySelector("#root")?.childElementCount);'),
    );
    await captureApp(driver, '');
  }
} finally {
  try {
    await driver?.close();
  } finally {
    desktop?.kill();
    fixtures.kill();
    await Promise.all([desktop?.exited, fixtures.exited]);
  }
}
