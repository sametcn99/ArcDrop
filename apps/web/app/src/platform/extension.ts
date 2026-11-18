import type { PlatformAdapter } from './types';

/**
 * Extension adapter (plan E1): used when the web app runs inside the ArcDrop
 * browser extension — today in the popup/options pages, from E3 also in the
 * embedded app page. Selected in `platform/index.ts` when `detectExtension()`
 * is true.
 */

/** Runtime surface the extension context exposes; typed structurally so
 * apps/web needs no @types/chrome dependency. */
interface ExtensionRuntimeLike {
  id?: string;
}

/**
 * True inside an extension page: MV3 exposes `chrome.runtime` with an `id`
 * only in extension contexts (popup, options, service worker, extension
 * pages) — plain browsers and Tauri webviews do not.
 */
export function detectExtension(): boolean {
  const runtime = (globalThis as { chrome?: { runtime?: ExtensionRuntimeLike } }).chrome?.runtime;
  return typeof runtime?.id === 'string' && runtime.id.length > 0;
}

/**
 * Extension implementation. The extension page's own `fetch` already goes
 * out CORS-free to the user's server origin (the extension requests exactly
 * that origin at setup time via optional host permissions), so no native
 * bridge is needed — unlike Tauri's plugin-http. Token refresh is handled by
 * the extension's background auth broker (E1), not by fetch interception.
 */
export function createExtensionPlatform(): PlatformAdapter {
  return {
    isTauri: false,

    // Resolve the global fetch per call so test stubs are picked up at
    // invocation time (same contract as the browser adapter).
    getFetch: () => (input, init) => fetch(input, init),

    openExternal: (url) => {
      // Extension pages may not navigate themselves to http(s) targets, but
      // a new tab opened this way lands in the browser — the "open in app"
      // and doc links use this.
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    // Extension pages have no hardware back button; the popup/options close
    // with the window, like a plain browser page.
    onBackButton: () => () => {},

    share: async (text, url) => {
      if (typeof navigator.share !== 'function') {
        return false;
      }
      try {
        await navigator.share({ text, ...(url !== undefined ? { url } : {}) });
        return true;
      } catch {
        // Unsupported in this context or dismissed — treated as "not shared".
        return false;
      }
    },

    // Extension pages expose no native OS bridge; the session list keeps the
    // API-derived label (browser parity, plan T2).
    resolveDeviceLabel: async () => null,
  };
}
