import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@api/config/env.schema';
import { IconCacheService } from './icon-cache.service';

const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

const configWith = (dataDir: string): AppConfig => ({ dataDir }) as unknown as AppConfig;

describe('IconCacheService', () => {
  let dataDir: string;
  let icons: IconCacheService;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'arcdrop-icons-test-'));
    icons = new IconCacheService(configWith(dataDir));
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('stores a png and hands back a well-formed ref', async () => {
    const ref = await icons.store(PNG_BYTES, 'image/png');
    expect(ref).toMatch(/^[A-Za-z0-9_-]{32}\.png$/);
    expect(icons.contentTypeOf(ref)).toBe('image/png');
  });

  it('stores the same bytes under different content types with mapped extensions', async () => {
    const jpg = await icons.store(PNG_BYTES, 'image/jpeg');
    expect(jpg.endsWith('.jpg')).toBeTrue();
    expect(icons.contentTypeOf(jpg)).toBe('image/jpeg');

    const icon = await icons.store(PNG_BYTES, 'image/vnd.microsoft.icon');
    expect(icon.endsWith('.ico')).toBeTrue();
    expect(icons.contentTypeOf(icon)).toBe('image/x-icon');
  });

  it('refuses non-allowlisted content types (svg included — stored XSS)', async () => {
    for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream', '']) {
      await expect(icons.store(PNG_BYTES, type)).rejects.toThrow('icon cache refuses content type');
    }
  });

  it('refuses empty and oversized bodies', async () => {
    await expect(icons.store(new Uint8Array(0), 'image/png')).rejects.toThrow('empty body');
    await expect(icons.store(new Uint8Array(2 * 1024 * 1024 + 1), 'image/png')).rejects.toThrow(
      'oversized',
    );
  });

  it('round-trips the bytes', async () => {
    const ref = await icons.store(PNG_BYTES, 'image/png');
    const read = await icons.read(ref);
    expect(read).not.toBeNull();
    expect(read?.contentType).toBe('image/png');
    expect(Buffer.from(read?.bytes ?? new Uint8Array()).equals(Buffer.from(PNG_BYTES))).toBeTrue();
  });

  it('reads null for unknown or malformed refs (traversal included)', async () => {
    expect(await icons.read('x'.repeat(32) + '.png')).toBeNull();
    expect(await icons.read('../../etc/passwd')).toBeNull();
    expect(await icons.read('../secrets.png')).toBeNull();
    expect(await icons.read('nested/dirabcdefghijklmnopq.png')).toBeNull();
    expect(await icons.read('short.png')).toBeNull();
    expect(await icons.read('')).toBeNull();
    expect(await icons.read(`${'a'.repeat(32)}.svg`)).toBeNull(); // svg is not servable
  });

  it('mints unguessable refs (no repeats across many stores)', async () => {
    const refs = new Set<string>();
    for (let i = 0; i < 50; i++) refs.add(await icons.store(PNG_BYTES, 'image/png'));
    expect(refs.size).toBe(50);
  });

  describe('evictExcept', () => {
    it('removes only unreferenced well-formed files and never foreign files', async () => {
      // Fresh directory — earlier tests in this file store files too, and
      // eviction must be evaluated against an isolated world.
      const isolatedDir = join(dataDir, 'eviction-world');
      const isolated = new IconCacheService(configWith(isolatedDir));

      const keep1 = await isolated.store(PNG_BYTES, 'image/png');
      const keep2 = await isolated.store(PNG_BYTES, 'image/gif');
      const stale = await isolated.store(PNG_BYTES, 'image/webp');
      const foreign = join(isolated.iconsDir, 'README.txt');
      writeFileSync(foreign, 'not an icon');

      const evicted = await isolated.evictExcept(new Set([keep1, keep2]));
      expect(evicted).toBe(1);

      expect(await isolated.read(keep1)).not.toBeNull();
      expect(await isolated.read(keep2)).not.toBeNull();
      expect(await isolated.read(stale)).toBeNull();
      expect(await isolated.read('README.txt')).toBeNull(); // not a valid ref — but the FILE must survive
      expect(existsSync(foreign)).toBeTrue();
    });

    it('is a no-op when the directory does not exist', async () => {
      const empty = new IconCacheService(configWith(join(dataDir, 'does-not-exist')));
      expect(await empty.evictExcept(new Set())).toBe(0);
    });
  });
});
