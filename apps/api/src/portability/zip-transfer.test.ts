import { describe, expect, it } from 'bun:test';
import { createZipBuffer } from './export/zip-writer';
import { readZipImport } from './zip-transfer';

describe('ZIP transfer limits', () => {
  const entry = {
    name: 'sample.txt',
    bytes: Buffer.from('https://example.com\n'),
    modifiedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const limits = { expandedMax: 1000, maxEntries: 5, documentMax: 1000 };

  it('imports a regular ZIP within the configured limits', async () => {
    const result = await readZipImport(createZipBuffer([entry]), '/unused', limits);
    expect(result.bookmarks.map(({ url }) => url)).toEqual(['https://example.com']);
    expect(result.errors).toEqual([]);
  });

  it('rejects otherwise valid ZIPs beyond the expanded or entry limits', async () => {
    const oneMember = createZipBuffer([entry]);
    await expect(
      readZipImport(oneMember, '/unused', { ...limits, expandedMax: entry.bytes.length - 1 }),
    ).rejects.toThrow('ZIP exceeds the expanded size limit');

    const twoMembers = createZipBuffer([entry, { ...entry, name: 'next.txt' }]);
    await expect(
      readZipImport(twoMembers, '/unused', { ...limits, maxEntries: 1 }),
    ).rejects.toThrow('ZIP has too many members');
  });
});
