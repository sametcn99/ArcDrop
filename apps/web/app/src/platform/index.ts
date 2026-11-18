import { createBrowserPlatform, detectTauri } from './browser';
import { createExtensionPlatform, detectExtension } from './extension';
import { createTauriPlatform } from './tauri';
import type { PlatformAdapter } from './types';

export type { PlatformAdapter } from './types';

/**
 * Adapter selection (exported separately for tests): a Tauri webview
 * (`__TAURI_INTERNALS__` present) uses the Tauri-native adapter (T2:
 * plugin-http fetch, opener, OS device label); an extension context (MV3,
 * `chrome.runtime.id` present) uses the extension adapter (E1); everything
 * else runs on the plain browser implementation.
 */
export function selectPlatform(): PlatformAdapter {
  if (detectTauri()) {
    return createTauriPlatform();
  }
  if (detectExtension()) {
    return createExtensionPlatform();
  }
  return createBrowserPlatform();
}

/**
 * Single platform adapter instance used by the API client and UI. Detection
 * happens at module init — inside a Tauri webview `__TAURI_INTERNALS__` is
 * injected before any app script runs, so the selection is reliable there.
 */
export const platform: PlatformAdapter = selectPlatform();
