import { describe, expect, it } from 'bun:test';
import { readZipEntries } from '../import/zip-reader';
import { crc32, createZipBuffer } from './zip-writer';

describe('zip-writer (M18)', () => {
  it('computes standard IEEE 802.3 CRC-32 values', () => {
    expect(crc32(Buffer.from('123456789', 'utf8'))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it('creates valid classic ZIP archives that round-trip via readZipEntries', () => {
    const compressible = Buffer.from('ArcDrop export bundle entry '.repeat(40), 'utf8');
    const tiny = Buffer.from('hi', 'utf8');
    const empty = Buffer.alloc(0);
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

    const archive = createZipBuffer([
      { name: 'export.json', bytes: compressible },
      { name: 'tiny.txt', bytes: tiny },
      { name: 'empty.txt', bytes: empty },
      { name: 'files/çalışma-notları.png', bytes: binary },
    ]);

    const entries = readZipEntries(archive);
    expect(entries.map((e) => e.name)).toEqual([
      'export.json',
      'tiny.txt',
      'empty.txt',
      'files/çalışma-notları.png',
    ]);
    expect(entries[0]!.bytes.equals(compressible)).toBe(true);
    expect(entries[1]!.bytes.equals(tiny)).toBe(true);
    expect(entries[2]!.bytes.equals(empty)).toBe(true);
    expect(entries[3]!.bytes.equals(binary)).toBe(true);
  });
});
