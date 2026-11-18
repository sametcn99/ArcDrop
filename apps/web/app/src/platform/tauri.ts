import { addPluginListener, invoke as tauriInvoke } from '@tauri-apps/api/core';
import { onOpenUrl as deepLinkOnOpenUrl } from '@tauri-apps/plugin-deep-link';
import * as dialogPlugin from '@tauri-apps/plugin-dialog';
import * as fsPlugin from '@tauri-apps/plugin-fs';
import {
  isPermissionGranted as notificationIsPermissionGranted,
  requestPermission as notificationRequestPermission,
  sendNotification as notificationSend,
} from '@tauri-apps/plugin-notification';
import { fetch as pluginHttpFetch } from '@tauri-apps/plugin-http';
import { openUrl } from '@tauri-apps/plugin-opener';
import { type as osType, version as osVersion } from '@tauri-apps/plugin-os';
import { extractFirstUrl, parseQuickAddDeepLink } from './shareUrl';
import type { PlatformAdapter } from './types';

/**
 * Injectable plugin surface (plan T2/T3/T4). Production wires the official
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
  /** Notifications (plan T4). */
  notificationPermission?: () => Promise<'granted' | 'denied' | 'default'>;
  notificationSend?: (input: { title: string; body?: string }) => Promise<void>;
  /** Save dialog → write file (plan T4 downloads). */
  pickSavePath?: (defaultFileName: string) => Promise<string | null>;
  writeFileBytes?: (path: string, bytes: Uint8Array) => Promise<void>;
  /** Open dialog → read file (plan T4 uploads / share-file flow). */
  pickOpenPath?: () => Promise<string | null>;
  readFileBytes?: (path: string) => Promise<Uint8Array>;
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
  notificationPermission: async () => {
    if (!(await notificationIsPermissionGranted())) {
      return await notificationRequestPermission();
    }
    return 'granted';
  },
  notificationSend: async (input) => notificationSend(input),
  pickSavePath: (defaultFileName) => dialogPlugin.save({ defaultPath: defaultFileName }),
  writeFileBytes: (path, bytes) => fsPlugin.writeFile(path, bytes),
  pickOpenPath: () => dialogPlugin.open({ multiple: false, directory: false }),
  readFileBytes: (path) => fsPlugin.readFile(path),
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
      const deliverUrl = (raw: string) => {
        const url = extractFirstUrl(raw);
        if (url) {
          callback({ kind: 'url', url });
        }
      };
      const deliverPending = (pending: {
        kind?: string;
        text?: string;
        path?: string;
        fileName?: string;
        mime?: string;
      }) => {
        if (pending.kind === 'text' && typeof pending.text === 'string' && pending.text !== '') {
          deliverUrl(pending.text);
        } else if (pending.kind === 'file' && typeof pending.path === 'string') {
          callback({
            kind: 'file',
            path: pending.path,
            fileName: pending.fileName ?? '',
            mime: pending.mime ?? 'application/octet-stream',
          });
        } else if (pending.kind === 'file-too-large' || pending.kind === 'file-error') {
          callback({ kind: pending.kind, fileName: pending.fileName ?? '' });
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
                deliverPending(payload as Record<string, unknown>);
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
            const pending = await deps.invoke<Record<string, unknown>>(
              'plugin:arcdrop-share-target|fetch_pending_share',
            );
            deliverPending(pending);
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
                  callback({ kind: 'url', url: target });
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

    // Notifications (plan T4): the plugin handles the OS permission flow
    // (Android 13+ POST_NOTIFICATIONS, iOS UNUserNotificationCenter).
    notify: async (input) => {
      try {
        if (!deps.notificationPermission) {
          return false;
        }
        const permission = await deps.notificationPermission();
        if (permission !== 'granted') {
          return false;
        }
        await deps.notificationSend?.(input);
        return true;
      } catch (error) {
        console.warn('Failed to send notification', error);
        return false;
      }
    },

    // Downloads (plan T4): ask where to save, write the bytes via plugin-fs.
    // Dialog-picked paths are admitted to the fs scope by plugin-dialog.
    saveBlob: async (blob, filename) => {
      try {
        if (!deps.pickSavePath || !deps.writeFileBytes) {
          return false;
        }
        const path = await deps.pickSavePath(filename);
        if (!path) {
          return false; // user cancelled
        }
        await deps.writeFileBytes(path, new Uint8Array(await blob.arrayBuffer()));
        return true;
      } catch (error) {
        console.warn('Failed to save file', error);
        return false;
      }
    },

    pickFile: async () => {
      try {
        if (!deps.pickOpenPath || !deps.readFileBytes) {
          return null;
        }
        const path = await deps.pickOpenPath();
        if (!path) {
          return null;
        }
        const bytes = await deps.readFileBytes(path);
        const fileName = path.split(/[\\/]/).pop() ?? path;
        return new File([bytes], fileName);
      } catch (error) {
        console.warn('Failed to pick file', error);
        return null;
      }
    },

    readLocalFile: async (path, fileName, mime) => {
      try {
        if (!deps.readFileBytes) {
          return null;
        }
        const bytes = await deps.readFileBytes(path);
        const name = fileName ?? path.split(/[\\/]/).pop() ?? path;
        return new File([bytes], name, mime ? { type: mime } : undefined);
      } catch (error) {
        console.warn('Failed to read local file', error);
        return null;
      }
    },
  };
}
