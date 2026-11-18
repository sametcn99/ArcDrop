// The shared vault: chrome.storage.local as the single source of truth for
// connection state (plan: popup, background broker and the E3 app page all
// read the same store). The background service worker is the only writer of
// tokens; the popup writes nothing.
//
// All functions take the storage area as a parameter so unit tests can pass
// an in-memory fake.

export interface VaultUser {
  id: string;
  email: string;
  role: string;
  status: string;
  hasPassword: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

export interface VaultSettings {
  /** E2 quick-save destination; options UI arrives in E5. */
  quickSaveTarget: 'last-used' | 'unsorted';
  /** Last collection the user explicitly saved into (quick-save "last used"). */
  lastUsedCollectionId: string | null;
}

/** Schema v1 — additive evolution only; bump `version` when reshaping. */
export interface VaultState {
  version: 1;
  /** Normalized server base URL (scheme + host [+ path], no trailing slash). */
  baseUrl: string | null;
  accessToken: string | null;
  /** Epoch ms expiry of the access JWT (from its exp claim). */
  accessTokenExpiresAt: number | null;
  /** Opaque rotating refresh token (~30 days; rotated on every use). */
  refreshToken: string | null;
  user: VaultUser | null;
  settings: VaultSettings;
}

export const DEFAULT_VAULT_SETTINGS: VaultSettings = {
  quickSaveTarget: 'last-used',
  lastUsedCollectionId: null,
};

export const DEFAULT_VAULT: VaultState = {
  version: 1,
  baseUrl: null,
  accessToken: null,
  accessTokenExpiresAt: null,
  refreshToken: null,
  user: null,
  settings: DEFAULT_VAULT_SETTINGS,
};

/** Minimal structural subset of chrome.storage.StorageArea (for tests). */
export interface StorageLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export type VaultChangeListener = (vault: VaultState) => void;

const VAULT_KEY = 'vault';

function asVaultState(raw: unknown): VaultState {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_VAULT, settings: { ...DEFAULT_VAULT_SETTINGS } };
  }
  const record = raw as Record<string, unknown>;
  const settings =
    typeof record['settings'] === 'object' && record['settings'] !== null
      ? { ...DEFAULT_VAULT_SETTINGS, ...(record['settings'] as Partial<VaultSettings>) }
      : { ...DEFAULT_VAULT_SETTINGS };
  return {
    version: 1,
    baseUrl: typeof record['baseUrl'] === 'string' ? record['baseUrl'] : null,
    accessToken: typeof record['accessToken'] === 'string' ? record['accessToken'] : null,
    accessTokenExpiresAt:
      typeof record['accessTokenExpiresAt'] === 'number' ? record['accessTokenExpiresAt'] : null,
    refreshToken: typeof record['refreshToken'] === 'string' ? record['refreshToken'] : null,
    user:
      typeof record['user'] === 'object' && record['user'] !== null
        ? (() => {
            const user = record['user'] as Record<string, unknown>;
            if (typeof user['id'] !== 'string' || typeof user['email'] !== 'string') return null;
            return {
              id: user['id'],
              email: user['email'],
              role: typeof user['role'] === 'string' ? user['role'] : 'user',
              status: typeof user['status'] === 'string' ? user['status'] : 'active',
              hasPassword: user['hasPassword'] !== false,
              totpEnabled: user['totpEnabled'] === true,
              createdAt:
                typeof user['createdAt'] === 'string'
                  ? user['createdAt']
                  : new Date(0).toISOString(),
            };
          })()
        : null,
    settings,
  };
}

export async function readVault(area: StorageLike): Promise<VaultState> {
  const stored = await area.get(VAULT_KEY);
  return asVaultState(stored[VAULT_KEY]);
}

/** Read-modify-write patch. The background broker is the designated writer. */
export type VaultPatch = Partial<Omit<VaultState, 'settings'>> & {
  settings?: Partial<VaultSettings>;
};

export async function writeVault(area: StorageLike, patch: VaultPatch): Promise<VaultState> {
  const current = await readVault(area);
  const next: VaultState = {
    ...current,
    ...patch,
    settings: { ...current.settings, ...(patch.settings ?? {}) },
    version: 1,
  };
  await area.set({ [VAULT_KEY]: next });
  return next;
}

/**
 * Disconnect cleanup: drops tokens + user, keeps the server address and
 * settings so reconnecting is one step (same as Vaultwarden's behavior).
 */
export async function clearSession(area: StorageLike): Promise<VaultState> {
  return writeVault(area, {
    accessToken: null,
    accessTokenExpiresAt: null,
    refreshToken: null,
    user: null,
  });
}

export function isSessionActive(vault: VaultState): boolean {
  return vault.refreshToken !== null && vault.user !== null;
}

export interface StorageChangeEvent {
  areaName: string;
}

/** Minimal structural subset of the chrome.storage.onChanged event. */
export interface StorageOnChangedLike {
  addListener(callback: (changes: Record<string, unknown>, areaName: string) => void): void;
  removeListener(callback: (changes: Record<string, unknown>, areaName: string) => void): void;
}

/**
 * Subscribes to vault changes (popup ↔ background sync). Returns an
 * unsubscribe function. Pass `chrome.storage.onChanged` in production code;
 * tests pass a fake.
 */
export function subscribeVault(
  onChanged: StorageOnChangedLike,
  onChange: VaultChangeListener,
): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string): void => {
    if (areaName !== 'local') return;
    if (!(VAULT_KEY in changes)) return;
    const change = changes[VAULT_KEY] as { newValue?: unknown } | undefined;
    onChange(asVaultState(change?.newValue));
  };
  onChanged.addListener(listener);
  return () => {
    onChanged.removeListener(listener);
  };
}
