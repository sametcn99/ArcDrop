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
   * True inside a Tauri webview on a desktop OS (plan T5: desktop-only UI
   * such as the autostart toggle). False in browsers/extensions; on mobile
   * webviews; resolves false when the OS type is unavailable.
   */
  readonly isDesktop: boolean;

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

  /**
   * Human-readable device label for the server-side session list ("Android ·
   * Pixel 8", "Desktop · Windows 11"), derived from the native OS API where
   * available. Resolves null when no native OS info exists (plain browser /
   * extension page) — callers keep their current behavior then.
   */
  resolveDeviceLabel(): Promise<string | null>;

  /**
   * Subscribes to share-target deliveries (plan T3/T4): Android ACTION_SEND
   * shares — URLs (custom plugin, incl. the cold-start queue) and shared
   * files (cache-copied) — plus desktop `arcdrop://add?url=…` deep links.
   * Returns an unsubscribe function; no-op in environments without a native
   * bridge.
   */
  onShareTarget(callback: (payload: ShareTargetEvent) => void): () => void;

  /**
   * Shows a local notification (plan T4). Browsers use the Notification API
   * only when permission is already granted (no permission prompt — the web
   * UX must not change); Tauri requests the OS permission (Android 13+
   * POST_NOTIFICATIONS, iOS) on first use. Resolves true when the
   * notification was shown.
   */
  notify(input: { title: string; body?: string }): Promise<boolean>;

  /**
   * Saves a blob to a user-chosen location (plan T4). Tauri: save dialog +
   * plugin-fs write; browsers: the classic synthetic-anchor download.
   * Resolves false when the user cancelled or saving failed.
   */
  saveBlob(blob: Blob, filename: string): Promise<boolean>;

  /**
   * Opens a native file picker and returns the selected file (plan T4).
   * Tauri: plugin-dialog open + plugin-fs read; browsers resolve null —
   * callers fall back to their existing `<input type="file">` element.
   */
  pickFile(): Promise<File | null>;

  /**
   * Reads a file from the local filesystem (plan T4 share-file flow: the
   * Android share-target plugin copies shared files into the app cache).
   * Browsers resolve null.
   */
  readLocalFile(path: string, fileName?: string, mime?: string): Promise<File | null>;
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

/** One share-target delivery (plan T3/T4): a URL, a shared file, or a refusal. */
export type ShareTargetEvent =
  | { kind: 'url'; url: string }
  | { kind: 'file'; path: string; fileName: string; mime: string }
  | { kind: 'file-too-large'; fileName: string }
  | { kind: 'file-error'; fileName: string };
