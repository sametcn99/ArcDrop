import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExtensionPlatform, detectExtension } from './extension';

describe('extension platform adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Drop a share capability installed by individual tests.
    Reflect.deleteProperty(window.navigator, 'share');
  });

  it('detectExtension is false without a chrome runtime', () => {
    vi.stubGlobal('chrome', undefined);
    expect(detectExtension()).toBe(false);
  });

  it('detectExtension is false when chrome exists without runtime.id', () => {
    vi.stubGlobal('chrome', { runtime: {} });
    expect(detectExtension()).toBe(false);
  });

  it('detectExtension is true when chrome.runtime.id is present', () => {
    vi.stubGlobal('chrome', { runtime: { id: 'arcdrop-extension' } });
    expect(detectExtension()).toBe(true);
  });

  it('reports isTauri false', () => {
    const platform = createExtensionPlatform();
    expect(platform.isTauri).toBe(false);
    expect(detectExtension()).toBe(false);
  });

  it('getFetch resolves the global fetch at call time', async () => {
    const fetchStub = vi.fn(
      async () => ({ status: 200, text: async () => 'ok' }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchStub);

    const platform = createExtensionPlatform();
    const response = await platform.getFetch()('https://server.example/api/v1/ping');

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith('https://server.example/api/v1/ping', undefined);
    expect(await response.text()).toBe('ok');
  });

  it('openExternal opens a new window without opener access', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const platform = createExtensionPlatform();

    platform.openExternal('https://example.com/article');

    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/article',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('onBackButton returns a no-op unsubscribe function', () => {
    const platform = createExtensionPlatform();
    const callback = vi.fn();
    const unsubscribe = platform.onBackButton(callback);

    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });

  it('share resolves false when the Web Share API is unavailable', async () => {
    const platform = createExtensionPlatform();
    await expect(platform.share('Look at this', 'https://example.com')).resolves.toBe(false);
  });
});
