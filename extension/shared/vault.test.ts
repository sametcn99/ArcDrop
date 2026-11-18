import { describe, expect, it } from 'bun:test';
import {
  clearSession,
  DEFAULT_VAULT,
  isSessionActive,
  readVault,
  subscribeVault,
  writeVault,
  type StorageLike,
  type StorageOnChangedLike,
  type VaultState,
} from './vault';

function fakeStorage(): StorageLike & { dump: () => Record<string, unknown> } {
  let data: Record<string, unknown> = {};
  return {
    get: async () => ({ ...data }),
    set: async (items) => {
      data = { ...data, ...items };
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    },
    dump: () => ({ ...data }),
  };
}

function fakeOnChanged(): StorageOnChangedLike & {
  emit: (changes: Record<string, unknown>, areaName: string) => void;
} {
  const listeners: Array<(changes: Record<string, unknown>, areaName: string) => void> = [];
  return {
    addListener: (listener) => listeners.push(listener),
    removeListener: (listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    emit: (changes, areaName) => {
      for (const listener of listeners) listener(changes, areaName);
    },
  };
}

const SESSION_PATCH = {
  accessToken: 'a-token',
  accessTokenExpiresAt: 123,
  refreshToken: 'r-token',
  user: { id: 'u1', email: 'me@example.com' },
} satisfies Partial<VaultState>;

describe('vault', () => {
  it('returns defaults on an empty store', async () => {
    const vault = await readVault(fakeStorage());
    expect(vault).toEqual(DEFAULT_VAULT);
    expect(vault.settings).toEqual(DEFAULT_VAULT.settings);
  });

  it('merges partial settings with defaults', async () => {
    const area = fakeStorage();
    await area.set({ vault: { version: 1, settings: { quickSaveTarget: 'unsorted' } } });
    const vault = await readVault(area);
    expect(vault.settings).toEqual({
      quickSaveTarget: 'unsorted',
      lastUsedCollectionId: null,
    });
    expect(vault.baseUrl).toBeNull();
  });

  it('writes patches and preserves untouched fields', async () => {
    const area = fakeStorage();
    await writeVault(area, { baseUrl: 'https://host' });
    const updated = await writeVault(area, SESSION_PATCH);
    expect(updated.baseUrl).toBe('https://host');
    expect(updated.refreshToken).toBe('r-token');
    expect((await readVault(area)).settings).toEqual(DEFAULT_VAULT.settings);
  });

  it('reports active sessions', async () => {
    const area = fakeStorage();
    expect(isSessionActive(await readVault(area))).toBe(false);
    await writeVault(area, SESSION_PATCH);
    expect(isSessionActive(await readVault(area))).toBe(true);
  });

  it('clearSession drops tokens + user but keeps baseUrl and settings', async () => {
    const area = fakeStorage();
    await writeVault(area, {
      baseUrl: 'https://host',
      settings: { quickSaveTarget: 'unsorted' },
    });
    await writeVault(area, SESSION_PATCH);
    const cleared = await clearSession(area);
    expect(cleared.baseUrl).toBe('https://host');
    expect(cleared.settings.quickSaveTarget).toBe('unsorted');
    expect(cleared.accessToken).toBeNull();
    expect(cleared.refreshToken).toBeNull();
    expect(cleared.user).toBeNull();
  });

  it('subscribes to vault-key changes in the local area only', () => {
    const onChanged = fakeOnChanged();
    const seen: VaultState[] = [];
    const unsubscribe = subscribeVault(onChanged, (vault) => seen.push(vault));

    onChanged.emit({ other: { newValue: 1 } }, 'local');
    onChanged.emit({ vault: { newValue: { version: 1, baseUrl: 'https://h' } } }, 'sync');
    expect(seen).toHaveLength(0);

    onChanged.emit({ vault: { newValue: { version: 1, baseUrl: 'https://h' } } }, 'local');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.baseUrl).toBe('https://h');

    unsubscribe();
    onChanged.emit({ vault: { newValue: { version: 1, baseUrl: 'https://z' } } }, 'local');
    expect(seen).toHaveLength(1);
  });
});
