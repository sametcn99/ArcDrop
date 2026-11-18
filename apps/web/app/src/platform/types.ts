/**
 * Platform adapter contract (plan T0): the UI and API client talk to native
 * capabilities exclusively through this interface. The browser implementation
 * is the default; the Tauri-native adapter (plugin-http fetch, opener, back
 * button, share) replaces it in T2 without touching call sites.
 */
export interface PlatformAdapter {
  /** True when running inside a Tauri webview (`window.__TAURI_INTERNALS__`). */
  readonly isTauri: boolean;

  /**
   * Fetch implementation for API calls. Browsers return the global fetch;
   * Tauri (T2) returns the CORS-free plugin-http fetch.
   */
  getFetch(): typeof fetch;

  /** Opens a URL outside the app window (system browser). */
  openExternal(url: string): void;

  /**
   * Subscribes to the hardware/gesture back button. Returns an unsubscribe
   * function; the browser implementation never fires the callback.
   */
  onBackButton(callback: () => void): () => void;

  /**
   * Shares text (and an optional URL) through the OS share sheet. Resolves
   * true when shared, false when unsupported or dismissed.
   */
  share(text: string, url?: string): Promise<boolean>;
}

declare global {
  interface Window {
    /** Tauri v2 IPC internals — presence marks a Tauri webview. */
    __TAURI_INTERNALS__?: unknown;
    /** Tauri's `withGlobalTauri` API surface; only `core.invoke` is used (T1). */
    __TAURI__?: TauriGlobalApi;
  }
}

/** Shape of the `window.__TAURI__` global enabled by `app.withGlobalTauri`. */
export interface TauriGlobalApi {
  core: {
    invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
  };
}
