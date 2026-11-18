import { fetch as pluginHttpFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { type as osType, version as osVersion } from '@tauri-apps/plugin-os';
import type { PlatformAdapter } from './types';

/**
 * Injectable plugin surface (plan T2). Production wires the official plugin
 * packages; tests pass stubs. Kept as sync getters because plugin-os resolves
 * its values from webview-injected internals without IPC.
 */
export interface TauriPlatformDeps {
  httpFetch: typeof fetch;
  openExternalUrl: (url: string) => Promise<void>;
  osType: () => string;
  osVersion: () => string;
  userAgent: () => string;
}

const defaultDeps: TauriPlatformDeps = {
  httpFetch: pluginHttpFetch,
  openExternalUrl: (url) => openUrl(url),
  osType: () => osType(),
  osVersion: () => osVersion(),
  userAgent: () => navigator.userAgent,
};

/**
 * Android WebViews expose the device model in the user agent
 * ("…; Android 14; SM-S918B)" / "…; SM-G991B Build/TP1A…; …"). plugin-os has
 * no model accessor, so this is the pragmatic source for "Android · <model>".
 */
export function androidModelFromUserAgent(userAgent: string): string | null {
  const match = /Android [\d.]+; ([^;)]+?)(?: Build\/|\)|;)/.exec(userAgent);
  const model = match?.[1]?.trim();
  return model ? model : null;
}

/**
 * Tauri-native implementation (plan T2): plugin-http fetch (CORS-free — the
 * user's own ArcDrop server needs no server-side CORS config), opener for
 * external links and the OS plugin for the session device label. Selected in
 * `platform/index.ts` when the app runs inside a Tauri webview.
 */
export function createTauriPlatform(deps: TauriPlatformDeps = defaultDeps): PlatformAdapter {
  return {
    isTauri: true,

    // plugin-http's fetch travels through the Rust IPC layer (capability:
    // http:default) so API requests are never subject to browser CORS —
    // required because the server address is entered at runtime.
    getFetch: () => deps.httpFetch,

    openExternal: (url) => {
      // opener sends http(s) links to the OS browser / Android Custom Tabs —
      // external URLs must never be swallowed by the app webview.
      deps.openExternalUrl(url).catch((error: unknown) => {
        console.warn('Failed to open external URL', error);
      });
    },

    // Android hardware back button: Tauri's built-in AppPlugin already
    // implements the required behavior as long as NO JS listener is
    // registered — web history back when possible, otherwise the activity
    // (the app) closes. Registering a listener here would disable that
    // default, so the adapter intentionally stays a no-op (see README).
    onBackButton: () => () => {},

    // Native share sheet lands with the share-target work (plan T3); until
    // then fall back to the Web Share API where the webview exposes it.
    share: async (text, url) => {
      if (typeof navigator.share !== 'function') {
        return false;
      }
      try {
        await navigator.share({ text, ...(url !== undefined ? { url } : {}) });
        return true;
      } catch {
        return false;
      }
    },

    resolveDeviceLabel: async () => {
      try {
        const os = deps.osType();
        if (os === 'android') {
          const deviceModel = androidModelFromUserAgent(deps.userAgent()) ?? '';
          return deviceModel ? `Android · ${deviceModel}` : 'Android';
        }
        if (os === 'ios') {
          return 'iOS';
        }
        const osName = os === 'macos' ? 'macOS' : os.charAt(0).toUpperCase() + os.slice(1);
        const osVersionText = deps.osVersion();
        return osVersionText ? `Desktop · ${osName} ${osVersionText}` : `Desktop · ${osName}`;
      } catch {
        return null;
      }
    },
  };
}
