import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@api/config/env.schema';
import { ArchiveStorageService } from './archive-storage.service';

describe('ArchiveStorageService (M17)', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'arcdrop-archive-test-'));
  const service = new ArchiveStorageService({ dataDir: tempRoot } as AppConfig);

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes, reads, and removes per-bookmark archive files under dataDir/archives/{id}', async () => {
    const id = crypto.randomUUID();
    const written = await service.write(id, {
      html: '<article><p>Hello archive</p></article>',
      text: 'Hello archive',
    });
    expect(written.htmlBytes).toBeGreaterThan(0);
    expect(written.textBytes).toBeGreaterThan(0);
    expect(existsSync(join(tempRoot, 'archives', id, 'content.html'))).toBe(true);
    expect(existsSync(join(tempRoot, 'archives', id, 'content.txt'))).toBe(true);

    const loaded = await service.read(id);
    expect(loaded).toEqual({
      html: '<article><p>Hello archive</p></article>',
      text: 'Hello archive',
    });

    await service.remove(id);
    expect(existsSync(join(tempRoot, 'archives', id))).toBe(false);
    expect(await service.read(id)).toBeNull();
  });

  it('rejects non-UUID bookmark ids against path traversal', async () => {
    await expect(service.write('../escape', { html: 'x', text: 'x' })).rejects.toThrow(
      'invalid bookmark id',
    );
    expect(await service.read('../escape')).toBeNull();
  });
});
