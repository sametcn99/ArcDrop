import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserPlatform, detectTauri } from './browser';

describe('browser platform adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Drop a share capability installed by individual tests.
    Reflect.deleteProperty(window.navigator, 'share');
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('detects the browser environment (isTauri false, no __TAURI_INTERNALS__)', () => {
    const platform = createBrowserPlatform();
    expect(platform.isTauri).toBe(false);
    expect(detectTauri()).toBe(false);
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

  it('share resolves false when the user dismisses the share sheet', async () => {
    const shareMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    Object.defineProperty(window.navigator, 'share', { value: shareMock, configurable: true });

    const platform = createBrowserPlatform();
    await expect(platform.share('Look at this')).resolves.toBe(false);
    expect(shareMock).toHaveBeenCalledWith({ text: 'Look at this' });
  });
});
