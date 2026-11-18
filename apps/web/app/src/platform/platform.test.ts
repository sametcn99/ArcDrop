import { afterEach, describe, expect, it, vi } from 'vitest';
import { logNativeAppVersion } from './native';
import { createBrowserPlatform, detectTauri } from './browser';

describe('browser platform adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Drop capabilities installed by individual tests.
    Reflect.deleteProperty(window.navigator, 'share');
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    Reflect.deleteProperty(window, '__TAURI__');
  });

  it('detects the browser environment (isTauri false, no __TAURI_INTERNALS__)', () => {
    const platform = createBrowserPlatform();
    expect(platform.isTauri).toBe(false);
    expect(detectTauri()).toBe(false);
  });

  it('isTauri is re-evaluated per access (late-initialized __TAURI_INTERNALS__)', () => {
    const platform = createBrowserPlatform();
    expect(platform.isTauri).toBe(false);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    expect(platform.isTauri).toBe(true);
  });

  it('detectTauri is true when __TAURI_INTERNALS__ is present', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    expect(detectTauri()).toBe(true);
  });

  it('getFetch resolves the global fetch at call time', async () => {
    const fetchStub = vi.fn(
      async () => ({ status: 200, text: async () => 'ok' }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchStub);

    const platform = createBrowserPlatform();
    const response = await platform.getFetch()('https://api.example.com/ping');

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith('https://api.example.com/ping', undefined);
    expect(await response.text()).toBe('ok');
  });

  it('openExternal opens a new window without opener access', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const platform = createBrowserPlatform();

    platform.openExternal('https://example.com/article');

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/article',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('onBackButton returns a no-op unsubscribe function', () => {
    const platform = createBrowserPlatform();
    const callback = vi.fn();
    const unsubscribe = platform.onBackButton(callback);

    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });

  it('share resolves false when the Web Share API is unavailable', async () => {
    const platform = createBrowserPlatform();
    await expect(platform.share('Look at this', 'https://example.com')).resolves.toBe(false);
  });

  it('share delegates to navigator.share and resolves true on success', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });

    const platform = createBrowserPlatform();
    await expect(platform.share('Look at this', 'https://example.com')).resolves.toBe(true);
    expect(shareMock).toHaveBeenCalledWith({ text: 'Look at this', url: 'https://example.com' });
  });

  it('resolveDeviceLabel resolves null without a native OS bridge (plan T2)', async () => {
    const platform = createBrowserPlatform();
    await expect(platform.resolveDeviceLabel()).resolves.toBeNull();
  });

  it('share resolves false when the user dismisses the share sheet', async () => {
    const shareMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });

    const platform = createBrowserPlatform();
    await expect(platform.share('Look at this')).resolves.toBe(false);
    expect(shareMock).toHaveBeenCalledWith({ text: 'Look at this' });
  });

  it('resolveDeviceLabel resolves null without a native OS bridge (plan T2)', async () => {
    const platform = createBrowserPlatform();
    await expect(platform.resolveDeviceLabel()).resolves.toBeNull();
  });

  it('notify shows a Notification only when permission is already granted (plan T4)', async () => {
    const platform = createBrowserPlatform();
    const notificationInstances: Array<{ title: string; body?: string }> = [];
    class NotificationStub {
      constructor(
        public title: string,
        public options?: { body?: string },
      ) {
        notificationInstances.push({ title, body: options?.body });
      }
      static permission: NotificationPermission = 'granted';
    }
    Object.defineProperty(window, 'Notification', {
      value: NotificationStub,
      configurable: true,
      writable: true,
    });

    expect(await platform.notify({ title: 'Reminder: Guide', body: 'body text' })).toBe(true);
    expect(notificationInstances).toEqual([{ title: 'Reminder: Guide', body: 'body text' }]);
  });

  it('notify stays a no-op when permission is not granted (no prompt — plan T4)', async () => {
    const platform = createBrowserPlatform();
    class NotificationStub {
      static permission: NotificationPermission = 'default';
      constructor() {
        throw new Error('should never be constructed');
      }
    }
    Object.defineProperty(window, 'Notification', {
      value: NotificationStub,
      configurable: true,
      writable: true,
    });

    expect(await platform.notify({ title: 'Reminder' })).toBe(false);
  });

  it('notify stays a no-op without the Notification API', async () => {
    const platform = createBrowserPlatform();
    Reflect.deleteProperty(window, 'Notification');
    expect(await platform.notify({ title: 'Reminder' })).toBe(false);
  });

  it('saveBlob keeps the classic browser download path (plan T4)', async () => {
    const createObjectURL = vi.fn(() => 'blob:http://localhost/abc');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { value: createObjectURL });
    Object.defineProperty(window.URL, 'revokeObjectURL', { value: revokeObjectURL });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const platform = createBrowserPlatform();
    const result = await platform.saveBlob(new Blob(['data']), 'file.txt');

    expect(result).toBe(true);
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    clickSpy.mockRestore();
    Reflect.deleteProperty(window.URL, 'createObjectURL');
    Reflect.deleteProperty(window.URL, 'revokeObjectURL');
  });
});

describe('logNativeAppVersion (T1 shell bridge check)', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    Reflect.deleteProperty(window, '__TAURI__');
  });

  it('is a no-op outside Tauri even with a __TAURI__ global present', () => {
    const invoke = vi.fn().mockResolvedValue('0.1.0');
    Object.defineProperty(window, '__TAURI__', { value: { core: { invoke } }, configurable: true });

    logNativeAppVersion();

    expect(invoke).not.toHaveBeenCalled();
  });

  it('invokes the shell app_version command once when inside Tauri', () => {
    const invoke = vi.fn().mockResolvedValue('0.1.0');
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    Object.defineProperty(window, '__TAURI__', { value: { core: { invoke } }, configurable: true });

    logNativeAppVersion();
    logNativeAppVersion();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('app_version');
  });

  it('tolerates a missing or malformed __TAURI__ global', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    Object.defineProperty(window, '__TAURI__', { value: { core: {} }, configurable: true });

    expect(() => logNativeAppVersion()).not.toThrow();
  });
});
