import { describe, expect, it, vi } from 'vitest';
import { androidModelFromUserAgent, createTauriPlatform, type TauriPlatformDeps } from './tauri';
import { selectPlatform } from './index';

function fakeDeps(overrides: Partial<TauriPlatformDeps> = {}): TauriPlatformDeps & {
  httpFetch: ReturnType<typeof vi.fn>;
  openExternalUrl: ReturnType<typeof vi.fn>;
  osType: ReturnType<typeof vi.fn>;
  osVersion: ReturnType<typeof vi.fn>;
  userAgent: ReturnType<typeof vi.fn>;
} {
  return {
    httpFetch: vi.fn(),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    osType: vi.fn().mockReturnValue('windows'),
    osVersion: vi.fn().mockReturnValue('11'),
    userAgent: vi.fn().mockReturnValue(''),
    ...overrides,
  } as TauriPlatformDeps & {
    httpFetch: ReturnType<typeof vi.fn>;
    openExternalUrl: ReturnType<typeof vi.fn>;
    osType: ReturnType<typeof vi.fn>;
    osVersion: ReturnType<typeof vi.fn>;
    userAgent: ReturnType<typeof vi.fn>;
  };
}

describe('androidModelFromUserAgent', () => {
  it('extracts the model from a modern Android WebView user agent', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
    expect(androidModelFromUserAgent(ua)).toBe('SM-S918B');
  });

  it('extracts the model from a legacy user agent with a Build suffix', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 13; SM-G991B Build/TP1A.220624.014; wv) AppleWebKit/537.36 Mobile Safari/537.36';
    expect(androidModelFromUserAgent(ua)).toBe('SM-G991B');
  });

  it('returns null when the user agent carries no model segment', () => {
    expect(androidModelFromUserAgent('Mozilla/5.0 (Linux; Android 14) Safari/537.36')).toBeNull();
    expect(androidModelFromUserAgent('')).toBeNull();
  });
});

describe('tauri platform adapter (plan T2)', () => {
  it('getFetch returns the injected plugin-http fetch (CORS-free IPC channel)', () => {
    const deps = fakeDeps();
    const platform = createTauriPlatform(deps);
    expect(platform.isTauri).toBe(true);
    expect(platform.getFetch()).toBe(deps.httpFetch);
  });

  it('openExternal routes URLs through the opener plugin', () => {
    const deps = fakeDeps();
    const platform = createTauriPlatform(deps);
    platform.openExternal('https://example.com/article');
    expect(deps.openExternalUrl).toHaveBeenCalledWith('https://example.com/article');
  });

  it('openExternal survives opener failures without throwing', async () => {
    const deps = fakeDeps({ openExternalUrl: vi.fn().mockRejectedValue(new Error('no browser')) });
    const platform = createTauriPlatform(deps);
    expect(() => platform.openExternal('https://example.com')).not.toThrow();
    // Allow the rejected promise branch to settle (it logs a warning).
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('onBackButton stays a no-op so the built-in Android handling remains active', () => {
    const callback = vi.fn();
    const platform = createTauriPlatform(fakeDeps());
    const unsubscribe = platform.onBackButton(callback);
    expect(() => unsubscribe()).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
  });

  it('resolveDeviceLabel formats Android devices as "Android · <model>" from the UA', async () => {
    const deps = fakeDeps({
      osType: vi.fn().mockReturnValue('android'),
      userAgent: vi
        .fn()
        .mockReturnValue(
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
        ),
    });
    const platform = createTauriPlatform(deps);
    await expect(platform.resolveDeviceLabel()).resolves.toBe('Android · Pixel 8');
  });

  it('resolveDeviceLabel falls back to the bare OS name without a UA model', async () => {
    const deps = fakeDeps({ osType: vi.fn().mockReturnValue('android'), userAgent: vi.fn() });
    const platform = createTauriPlatform(deps);
    await expect(platform.resolveDeviceLabel()).resolves.toBe('Android');
  });

  it('resolveDeviceLabel resolves "iOS" on iOS devices', async () => {
    const deps = fakeDeps({ osType: vi.fn().mockReturnValue('ios') });
    const platform = createTauriPlatform(deps);
    await expect(platform.resolveDeviceLabel()).resolves.toBe('iOS');
  });

  it('resolveDeviceLabel formats desktop OSes as "Desktop · <OS> <version>"', async () => {
    const platform = createTauriPlatform(fakeDeps());
    await expect(platform.resolveDeviceLabel()).resolves.toBe('Desktop · Windows 11');

    const macDeps = fakeDeps({
      osType: vi.fn().mockReturnValue('macos'),
      osVersion: vi.fn().mockReturnValue('15.1'),
    });
    await expect(createTauriPlatform(macDeps).resolveDeviceLabel()).resolves.toBe(
      'Desktop · macOS 15.1',
    );
  });

  it('resolveDeviceLabel resolves null when the OS plugin fails', async () => {
    const deps = fakeDeps({
      osType: vi.fn().mockImplementation(() => {
        throw new Error('os plugin unavailable');
      }),
    });
    const platform = createTauriPlatform(deps);
    await expect(platform.resolveDeviceLabel()).resolves.toBeNull();
  });

  it('selectPlatform picks the tauri adapter inside a Tauri webview', () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    try {
      expect(selectPlatform().isTauri).toBe(true);
    } finally {
      Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    }
  });

  it('selectPlatform picks the browser adapter in plain environments', () => {
    expect(selectPlatform().isTauri).toBe(false);
  });
});
