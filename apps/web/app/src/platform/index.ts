import { createBrowserPlatform } from './browser';
import type { PlatformAdapter } from './types';

export type { PlatformAdapter } from './types';

/**
 * Single platform adapter instance used by the API client and UI. T0 ships
 * the browser implementation; in T2 the Tauri-native adapter is selected here
 * when `platform.isTauri` is true (plugin-http fetch, opener, back button,
 * share).
 */
export const platform: PlatformAdapter = createBrowserPlatform();
