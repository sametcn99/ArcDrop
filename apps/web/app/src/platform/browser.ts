import type { PlatformAdapter } from './types';

/** True inside a Tauri v2 webview; the global window may be absent in tests. */
export function detectTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Browser (plain web) implementation: standard Web APIs everywhere, and
 * native-only capabilities degrade to safe no-ops. The Tauri adapter (T2)
 * overrides fetch/openExternal/back button/share with plugin equivalents.
 */
export function createBrowserPlatform(): PlatformAdapter {
  return {
    // Re-evaluated per access so late-initialized test doubles (and the Tauri
    // adapter swap in T2) are always observed correctly.
    get isTauri() {
      return detectTauri();
    },

    // Resolve the global fetch per call so test stubs (and, in T2, the native
    // implementation swap) are always picked up at invocation time.
    getFetch: () => (input, init) => fetch(input, init),

    openExternal: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },

    // Browsers have no back-button event to react to; the hardware/gesture
    // back navigation stays the user agent's business.
    onBackButton: () => () => {},

    share: async (text, url) => {
      if (typeof navigator.share !== 'function') {
        return false;
      }
      try {
        await navigator.share({ text, ...(url !== undefined ? { url } : {}) });
        return true;
      } catch {
        // User dismissed the share sheet or the share failed — treat both as
        // "not shared"; callers only use the result for optimistic UI.
        return false;
      }
    },

    // Browsers have no native OS bridge; the session list keeps whatever
    // label the API derives itself (existing behavior, plan T2).
    resolveDeviceLabel: async () => null,
  };
}
