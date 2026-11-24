const SESSION_KEY = 'arcdrop.browserSession';
export const LEGACY_REFRESH_KEY = 'arcdrop.refreshToken';

export interface BrowserSession {
  server: string;
  id: string;
  refreshToken: string;
}

export function readBrowserSession(): BrowserSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Partial<BrowserSession> | null;
    if (
      typeof session?.server === 'string' &&
      typeof session.id === 'string' &&
      typeof session.refreshToken === 'string'
    ) {
      return { server: session.server, id: session.id, refreshToken: session.refreshToken };
    }
  } catch {
    // Storage is unavailable or the value is unreadable.
  }
  return null;
}

export function writeBrowserSession(session: BrowserSession | null): boolean {
  try {
    if (session) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

export function isBrowserSessionEvent(event: StorageEvent): boolean {
  return event.key === SESSION_KEY || event.key === null;
}
