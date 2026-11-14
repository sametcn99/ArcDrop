import { describe, expect, it } from 'bun:test';
import { parseArcDropDocument, isArcDropJson } from './parse-arcdrop';
import { parseRaindropDocument, isRaindropJson } from './parse-raindrop';
import { detectJsonDialect, parsePayload } from './detect-format';

const ARCDOC = {
  format: 'arcdrop/v1',
  exportedAt: '2026-01-01T00:00:00.000Z',
  scope: null,
  collections: [
    { path: ['Work'], icon: null, color: null, order: 0 },
    { path: ['Work', 'Rust'], icon: '🦀', color: null, order: 0 },
  ],
  tags: ['a', 'b'],
  bookmarks: [
    {
      url: 'https://docs.example/guide',
      title: 'Guide',
      excerpt: null,
      note: 'read me',
      createdAt: '2025-06-01T10:00:00.000Z',
      updatedAt: '2025-06-02T10:00:00.000Z',
      tags: ['a', 'b'],
      collections: [['Work', 'Rust']],
      highlights: [],
    },
    {
      url: 'https://loose.example/',
      title: null,
      excerpt: null,
      note: null,
      createdAt: '2025-06-01T10:00:00.000Z',
      updatedAt: '2025-06-01T10:00:00.000Z',
      tags: [],
      collections: [],
      highlights: [{ text: 'future', color: 'yellow', createdAt: '2025-06-01T10:00:00.000Z' }],
    },
  ],
};

describe('parseArcDropDocument (round-trip format)', () => {
  it('maps collections to paths and bookmarks to items', () => {
    const result = parseArcDropDocument(ARCDOC);
    expect(result.collections).toHaveLength(2);
    expect(result.bookmarks).toHaveLength(2);
    expect(result.bookmarks[0]!.collectionPaths).toEqual([['Work', 'Rust']]);
    expect(result.bookmarks[0]!.tags).toEqual(['a', 'b']);
    expect(result.bookmarks[0]!.updatedAt).toBe('2025-06-02T10:00:00.000Z');
  });

  it('counts highlights as skipped-for-now (M10 hook)', () => {
    const result = parseArcDropDocument(ARCDOC);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toContain('M10');
  });

  it('errors on entries without a usable url', () => {
    const result = parseArcDropDocument({
      format: 'arcdrop/v1',
      bookmarks: [{ title: 'no url here' }],
    });
    expect(result.bookmarks).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.reason).toContain('url');
  });
});

const RAINDOC = {
  user: { name: 'someone' },
  collections: [
    { _id: 'aaa', title: 'Research' },
    { _id: 'bbb', title: 'Papers', parent: { $oid: 'aaa' } },
  ],
  bookmarks: [
    {
      title: 'A paper',
      link: 'https://papers.example/x',
      tags: ['ml'],
      collection: { $oid: 'bbb' },
      created: '2024-09-13T10:00:00.000Z',
      updated: '2024-09-14T10:00:00.000Z',
      excerpt: 'abstract',
      note: 'skimmed',
    },
    {
      title: 'Unsorted one',
      link: 'https://loose.example/y',
      tags: [],
      collection: { id: -1 },
      created: '2024-09-13T10:00:00.000Z',
      updated: '2024-09-13T10:00:00.000Z',
      highlights: [{ text: 'quoted' }],
    },
  ],
};

describe('parseRaindropDocument', () => {
  it('resolves parent chains into title paths', () => {
    const result = parseRaindropDocument(RAINDOC);
    expect(result.collections.map((c) => c.path)).toEqual([['Research'], ['Research', 'Papers']]);
  });

  it('maps items with collection refs and skips unsorted/broken refs', () => {
    const result = parseRaindropDocument(RAINDOC);
    expect(result.bookmarks).toHaveLength(2);
    const paper = result.bookmarks.find((b) => b.url === 'https://papers.example/x')!;
    expect(paper.collectionPaths).toEqual([['Research', 'Papers']]);
    expect(paper.tags).toEqual(['ml']);
    const loose = result.bookmarks.find((b) => b.url === 'https://loose.example/y')!;
    expect(loose.collectionPaths).toEqual([]);
  });

  it('counts raindrop highlights as skipped', () => {
    const result = parseRaindropDocument(RAINDOC);
    expect(result.skipped.some((s) => s.reason.includes('highlights'))).toBe(true);
  });
});

describe('JSON dialect detection', () => {
  it('recognizes both dialects', () => {
    expect(detectJsonDialect(JSON.stringify(ARCDOC))).toBe('arcdrop');
    expect(detectJsonDialect(JSON.stringify(RAINDOC))).toBe('raindrop');
    expect(detectJsonDialect('{"hello": 1}')).toBe(null);
    expect(detectJsonDialect('not json at all')).toBe(null);
  });

  it('isArcDropJson / isRaindropJson agree with the detector', () => {
    expect(isArcDropJson(ARCDOC)).toBe(true);
    expect(isRaindropJson(RAINDOC)).toBe(true);
    expect(isRaindropJson(ARCDOC)).toBe(false);
  });

  it('parsePayload routes json to the right parser', () => {
    const arc = parsePayload('json', JSON.stringify(ARCDOC));
    expect(arc.collections).toHaveLength(2);
    const rain = parsePayload('json', JSON.stringify(RAINDOC));
    expect(rain.bookmarks).toHaveLength(2);
    const unknown = parsePayload('json', '{"nothing": true}');
    expect(unknown.errors[0]!.reason).toContain('unrecognized JSON dialect');
  });
});
