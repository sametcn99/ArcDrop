import { describe, expect, it } from 'bun:test';
import { readZipEntries, ZipParseError } from './zip-reader';
import { buildTestZip } from '../../../test/zip-builder';
import { parseZipImport } from './parse-zip';

describe('zip-reader (minimal classic ZIP)', () => {
  it('reads stored and deflate members byte-faithfully', () => {
    const archive = buildTestZip([
      { name: 'links.txt', content: 'https://a.example\nhttps://b.example\n' },
      {
        name: 'big.csv',
        content: 'url,title,tags,collections\nhttps://c.example,C,tag1;tag2,Folder\n',
        deflate: true,
      },
      { name: 'nested/', content: '' },
    ]);
    const entries = readZipEntries(archive);
    expect(entries.map((entry) => entry.name)).toEqual(['links.txt', 'big.csv']);
    expect(entries[0]!.bytes.toString('utf8')).toContain('https://b.example');
    expect(entries[1]!.bytes.toString('utf8')).toContain('tag1;tag2');
  });

  it('survives an archive comment after the EOCD', () => {
    const base = buildTestZip([{ name: 'a.txt', content: 'x' }]);
    const archive = Buffer.concat([base, Buffer.from('some archiver comment', 'utf8')]);
    const entries = readZipEntries(archive);
    expect(entries).toHaveLength(1);
  });

  it('refuses non-zip bytes with a clear error', () => {
    expect(() => readZipEntries(Buffer.from('plain text, not a zip'))).toThrow(ZipParseError);
  });
});

describe('parseZipImport (G3: every supported member)', () => {
  it('processes mixed formats and aggregates one summary', () => {
    const archive = buildTestZip([
      { name: 'urls.txt', content: 'https://from-txt.example/a\n' },
      {
        name: 'bookmarks.html',
        content: '<DL><p><DT><A HREF="https://from-html.example/">H</A></DL>',
      },
      {
        name: 'rows.csv',
        content: 'url,title,tags,collections\nhttps://from-csv.example/,T,x,Y\n',
      },
      {
        name: 'clip.enex',
        content:
          '<en-export><note><title>C</title><content><![CDATA[<en-note><a href="https://from-enex.example/">go</a></en-note>]]></content><tag>z</tag></note></en-export>',
      },
      { name: 'readme.md', content: '# unsupported' },
      { name: 'nested/', content: '' },
    ]);
    const result = parseZipImport(archive);

    const urls = result.bookmarks.map((b) => b.url).sort();
    expect(urls).toEqual([
      'https://from-csv.example/',
      'https://from-enex.example/',
      'https://from-html.example/',
      'https://from-txt.example/a',
    ]);
    // The CSV row's collection path survived the archive trip.
    const csv = result.bookmarks.find((b) => b.url === 'https://from-csv.example/')!;
    expect(csv.collectionPaths).toEqual([['Y']]);
    // The unsupported .md is skipped and counted with its member name.
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.source).toBe('readme.md');
  });

  it('prefixes member-level errors with the archive member name', () => {
    const archive = buildTestZip([{ name: 'broken.txt', content: 'not-a-url\n' }]);
    const result = parseZipImport(archive);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.source).toContain('broken.txt');
  });

  it('refuses a corrupted archive with one clear error', () => {
    const result = parseZipImport(Buffer.from('garbage'));
    expect(result.bookmarks).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.reason).toContain('ZIP');
  });
});
