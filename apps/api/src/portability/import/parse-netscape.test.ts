import { describe, expect, it } from 'bun:test';
import { parseNetscapeImport } from './parse-netscape';

const FIXTURE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001">Dev</H3>
    <DL><p>
        <DT><H3>Nested</H3>
        <DL><p>
            <DT><A HREF="https://deep.example/page" ADD_DATE="1700000100" TAGS="reading,important">Deep Page</A>
            <DD>Some description &amp; note
        </DL><p>
        <DT><A HREF="https://dev.example/tool" ADD_DATE="1700000200">Dev Tool</A>
    </DL><p>
    <DT><A HREF="https://root.example/" ADD_DATE="1700000300">Root Link</A>
</DL><p>`;

describe('parseNetscapeImport (browser bookmark HTML)', () => {
  const result = parseNetscapeImport(FIXTURE);

  it('imports every bookmark', () => {
    expect(result.bookmarks).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('preserves the folder nesting as collection paths', () => {
    const deep = result.bookmarks.find((b) => b.url === 'https://deep.example/page')!;
    expect(deep.collectionPaths).toEqual([['Dev', 'Nested']]);
    const dev = result.bookmarks.find((b) => b.url === 'https://dev.example/tool')!;
    expect(dev.collectionPaths).toEqual([['Dev']]);
    const root = result.bookmarks.find((b) => b.url === 'https://root.example/')!;
    expect(root.collectionPaths).toEqual([]);
  });

  it('decodes entities and maps <DD> to the note', () => {
    const deep = result.bookmarks.find((b) => b.url === 'https://deep.example/page')!;
    expect(deep.title).toBe('Deep Page');
    expect(deep.note).toBe('Some description & note');
  });

  it('converts ADD_DATE unix seconds to ISO', () => {
    const deep = result.bookmarks.find((b) => b.url === 'https://deep.example/page')!;
    expect(deep.createdAt).toBe(new Date(1700000100 * 1000).toISOString());
  });

  it('splits the TAGS attribute on commas', () => {
    const deep = result.bookmarks.find((b) => b.url === 'https://deep.example/page')!;
    expect(deep.tags).toEqual(['reading', 'important']);
  });

  it('heals unbalanced markup without losing bookmarks', () => {
    const broken = '<DL><p><DT><A HREF="https://x.example/">X</A></DL>';
    const healed = parseNetscapeImport(broken);
    expect(healed.bookmarks).toHaveLength(1);
    expect(healed.bookmarks[0]!.url).toBe('https://x.example/');
  });

  it('reports invalid hrefs as errors, not crashes', () => {
    const result2 = parseNetscapeImport('<DL><p><DT><A HREF="nope">Bad</A></DL>');
    expect(result2.bookmarks).toHaveLength(0);
    expect(result2.errors).toHaveLength(1);
    expect(result2.errors[0]!.source).toContain('Bad');
  });
});
