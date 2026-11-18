import { platform } from './index';

// Single-fire guard: the version is logged once per app boot (React
// StrictMode mounts the boot effect twice in development).
let logged = false;

/**
 * Minimal T1 bridge check (plan T1): inside a Tauri webview, invokes the
 * shell's `app_version` command once and logs it, proving the invoke channel
 * works. Browser environments are a no-op; there is no UI dependency — the
 * log line is the only observable.
 */
export function logNativeAppVersion(): void {
  if (logged || !platform.isTauri) {
    return;
  }
  const tauri = typeof window === 'undefined' ? undefined : window.__TAURI__;
  if (!tauri || typeof tauri.core?.invoke !== 'function') {
    return;
  }
  logged = true;
  void tauri.core
    .invoke<string>('app_version')
    .then((version) => {
      console.info(`ArcDrop shell version: ${version}`);
    })
    .catch((error: unknown) => {
      console.warn('Failed to query native app version', error);
    });
}
