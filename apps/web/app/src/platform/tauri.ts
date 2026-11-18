import { addPluginListener, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { onOpenUrl as deepLinkOnOpenUrl } from '@tauri-apps/plugin-deep-link';
import { fetch as pluginHttpFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { type as osType, version as osVersion } from '@tauri-apps/plugin-os';
import { extractFirstUrl, parseQuickAddDeepLink } from './shareUrl';
import type { PlatformAdapter } from './types';

/**
 * Injectable plugin surface (plan T2/T3). Production wires the official
 * plugin packages; tests pass stubs. Kept as sync getters because plugin-os
 * resolves its values from webview-injected internals without IPC.
 */
export interface TauriPlatformDeps {
  httpFetch: typeof fetch;
  openExternalUrl: (url: string) => Promise<void>;
  osType: () => string;
  osVersion: () => string;
  userAgent: () => string;
  /** Plugin event channel (share-target warm start). */
  addPluginListener?: (
    plugin: string,
    event: string,
    callback: (payload: unknown) => void,
  ) => Promise<{ unlisten: () => void | Promise<void> }>;
  /** Command channel (share-target cold-start queue fetch). */
  invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  /** Desktop deep links (arcdrop://…). */
  onOpenUrl?: (callback: (urls: string[]) => void) => Promise<() => void>;
}

const defaultDeps: TauriPlatformDeps = {
  httpFetch: pluginHttpFetch,
  openExternalUrl: (url) => openUrl(url),
  osType: () => osType(),
  osVersion: () => osVersion(),
  userAgent: () => navigator.userAgent,
  addPluginListener: async (plugin, event, callback) => {
    const listener = await addPluginListener(plugin, event, (payload: unknown) =>
      callback(payload),
    );
    return { unlisten: () => listener.unregister() };
  },
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => tauriInvoke<T>(cmd, args),
  onOpenUrl: (callback) => deepLinkOnOpenUrl((urls: string[]) => callback(urls)),
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

    // Share-target stream (plan T3): Android plugin events (warm start), the
    // plugin's cold-start queue, and desktop arcdrop:// deep links all funnel
    // through one callback. Individual channels failing (e.g. desktop has no
    // Android plugin) degrade to no-ops — the stream stays usable.
    onShareTarget: (callback) => {
      let disposed = false;
      const unlisteners: Array<() => void> = [];
      const deliver = (raw: string) => {
        const url = extractFirstUrl(raw);
        if (url) {
          callback(url);
        }
      };

      void (async () => {
        if (disposed) {
          return;
        }
        // Warm start: live ACTION_SEND while the app is open.
        try {
          if (deps.addPluginListener) {
            const listener = await deps.addPluginListener(
              'arcdrop-share-target',
              'new-share',
              (payload: unknown) => {
                const text = (payload as { text?: unknown } | null)?.text;
                if (typeof text === 'string' && text !== '') {
                  deliver(text);
                }
              },
            );
            if (disposed) {
              listener.unlisten();
              return;
            }
            unlisteners.push(listener.unlisten);
          }
        } catch (error) {
          console.debug('share-target event channel unavailable', error);
        }

        // Cold start: the share arrived before the web client registered.
        try {
          if (deps.invoke) {
            const pending = await deps.invoke<{ text?: string }>(
              'plugin:arcdrop-share-target|fetch_pending_share',
            );
            if (typeof pending?.text === 'string' && pending.text !== '') {
              deliver(pending.text);
            }
          }
        } catch (error) {
          console.debug('share-target queue unavailable', error);
        }

        // Desktop deep links: arcdrop://add?url=…
        try {
          if (deps.onOpenUrl) {
            const unlistenOpen = await deps.onOpenUrl((urls) => {
              for (const link of urls) {
                const target = parseQuickAddDeepLink(link);
                if (target) {
                  callback(target);
                }
              }
            });
            if (disposed) {
              unlistenOpen();
              return;
            }
            unlisteners.push(unlistenOpen);
          }
        } catch (error) {
          console.debug('deep-link channel unavailable', error);
        }
      })();

      return () => {
        disposed = true;
        for (const unlisten of unlisteners) {
          unlisten();
        }
      };
    },
  };
}
