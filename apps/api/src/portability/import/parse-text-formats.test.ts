import { describe, expect, it } from 'bun:test';
import { parseTxtImport } from './parse-txt';
import { parseCsvImport } from './parse-csv';

describe('parseTxtImport (G3: one URL per line)', () => {
  it('parses url lines into bookmark candidates', () => {
    const result = parseTxtImport('https://a.example.com/x\nhttps://b.example.org/\n');
    expect(result.bookmarks).toHaveLength(2);
    expect(result.bookmarks[0]!.url).toBe('https://a.example.com/x');
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('ignores blank lines silently (trailing newlines are not skips)', () => {
    const result = parseTxtImport('https://a.example.com\n\n   \nhttps://b.example.org\n');
    expect(result.bookmarks).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it('reports non-URL lines as errors with their line number', () => {
    const result = parseTxtImport('https://good.example\nnot a url at all');
    expect(result.bookmarks).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.source).toBe('line 2');
    expect(result.errors[0]!.reason).toContain('valid absolute URL');
  });

  it('rejects urls without a host like the domain rules do (D12)', () => {
    const result = parseTxtImport('mailto:someone@example.com');
    expect(result.bookmarks).toHaveLength(0);
    expect(result.errors[0]!.reason).toContain('host');
  });
});

describe('parseCsvImport (our CSV export columns)', () => {
  const header = 'url,title,excerpt,note,tags,collections,createdAt,updatedAt';

  it('parses rows with all columns', () => {
    const result = parseCsvImport(
      `${header}\nhttps://x.example,t, e , n ,a;b,Parent/Child,2026-01-01T00:00:00.000Z,2026-01-02T00:00:00.000Z`,
    );
    expect(result.bookmarks).toHaveLength(1);
    const item = result.bookmarks[0]!;
    expect(item.url).toBe('https://x.example');
    expect(item.title).toBe('t');
    expect(item.excerpt).toBe('e');
    expect(item.note).toBe('n');
    expect(item.tags).toEqual(['a', 'b']);
    expect(item.collectionPaths).toEqual([['Parent', 'Child']]);
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('errors on rows with an empty url cell (with row number)', () => {
    const result = parseCsvImport(`${header}\n,t,t2,,,'',,`);
    expect(result.bookmarks).toHaveLength(0);
    expect(result.errors[0]!.source).toBe('row 2');
    expect(result.errors[0]!.reason).toContain('url cell is empty');
  });

  it('refuses files without a url column header', () => {
    const result = parseCsvImport('a,b\n1,2');
    expect(result.bookmarks).toHaveLength(0);
    expect(result.errors[0]!.reason).toContain('no "url" column');
  });

  it('handles quoted fields containing commas and semicolons', () => {
    const result = parseCsvImport(
      `${header}\n"https://x.example,a","title, with comma",,,tag1;tag2,"A/B;C",,`,
    );
    const item = result.bookmarks[0]!;
    expect(item.url).toBe('https://x.example,a');
    expect(item.title).toBe('title, with comma');
    expect(item.tags).toEqual(['tag1', 'tag2']);
    expect(item.collectionPaths).toEqual([['A', 'B'], ['C']]);
  });

  it('keeps garbage dates out (lenient) rather than erroring', () => {
    const result = parseCsvImport(`${header}\nhttps://x.example,,,,,not-a-date,`);
    expect(result.bookmarks).toHaveLength(1);
    expect(result.bookmarks[0]!.createdAt).toBeNull();
  });
});
