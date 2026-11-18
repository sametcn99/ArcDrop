import { createBrowserPlatform } from './browser';
import { createExtensionPlatform, detectExtension } from './extension';
import type { PlatformAdapter } from './types';

export type { PlatformAdapter } from './types';

/**
 * Single platform adapter instance used by the API client and UI. Selection
 * order: extension context (MV3, `chrome.runtime.id` present) → extension
 * adapter (E1); otherwise the browser implementation. In T2 the Tauri-native
 * adapter joins this selection when `platform.isTauri` is true (plugin-http
 * fetch, opener, back button, share).
 */
export const platform: PlatformAdapter = detectExtension()
  ? createExtensionPlatform()
  : createBrowserPlatform();
