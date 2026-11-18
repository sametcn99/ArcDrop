import type { PlatformAdapter } from './types';

function isExternalHttpUrl(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) {
    return false;
  }
  try {
    return new URL(href, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Routes external http(s) anchor clicks through platform.openExternal inside
 * Tauri (plan T2): links the app renders for the user's data (bookmarks,
 * markdown previews, public shares) must open in the OS browser / Custom
 * Tabs instead of being swallowed by the app webview. Capture-phase click
 * listener so app-internal handlers stay untouched; blob/data downloads (the
 * synthetic-download anchor) and same-origin navigation pass through.
 * No-op outside Tauri. Returns an uninstaller.
 */
export function installExternalLinkInterceptor(adapter: PlatformAdapter): () => void {
  if (!adapter.isTauri) {
    return () => {};
  }

  const handler = (event: MouseEvent) => {
    // Modified clicks (new tab, copy link, downloads) keep native behavior.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }
    const href = anchor.getAttribute('href') ?? '';
    if (!isExternalHttpUrl(href)) {
      return;
    }
    event.preventDefault();
    adapter.openExternal(anchor.href);
  };

  document.addEventListener('click', handler, true);
  return () => {
    document.removeEventListener('click', handler, true);
  };
}
