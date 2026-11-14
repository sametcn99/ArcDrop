import { describe, expect, it } from 'bun:test';
import { parseEnexImport } from './parse-enex';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<en-export exportDate="20261114T100000Z" application="Evernote">
  <note>
    <title>Clipped: ArcDrop README</title>
    <content><![CDATA[<en-note><div>Some page text</div>
      <a href="https://github.com/sametcn99/ArcDrop">ArcDrop on GitHub</a>
    </en-note>]]></content>
    <tag>open source</tag>
    <tag>bookmarks</tag>
    <created>20231118T120000Z</created>
    <updated>20231119T120000Z</updated>
  </note>
  <note>
    <title>A plain recipe note</title>
    <content><![CDATA[<en-note><div>2 eggs, whisk well</div></en-note>]]></content>
    <tag>cooking</tag>
    <created>20240101T080000Z</created>
  </note>
  <note>
    <title>Internal link only</title>
    <content><![CDATA[<en-note><a href="evernote:///view/12345">my other note</a></en-note>]]></content>
    <created>20240102T080000Z</created>
  </note>
</en-export>`;

describe('parseEnexImport (Evernote — web clips only, G3)', () => {
  const result = parseEnexImport(FIXTURE);

  it('imports only the web clip (external http link present)', () => {
    expect(result.bookmarks).toHaveLength(1);
    expect(result.bookmarks[0]!.url).toBe('https://github.com/sametcn99/ArcDrop');
  });

  it('carries the clip title, tags and created date', () => {
    const clip = result.bookmarks[0]!;
    expect(clip.title).toBe('Clipped: ArcDrop README');
    expect(clip.tags).toEqual(['open source', 'bookmarks']);
    expect(clip.createdAt).toBe('2023-11-18T12:00:00.000Z'); // Evernote stamp parsed
  });

  it('skips regular notes and counts them with a reason', () => {
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0]!.reason).toContain('regular note');
    expect(result.skipped[0]!.source).toContain('A plain recipe note');
  });

  it('skips notes whose only link is evernote-internal', () => {
    const sources = result.skipped.map((entry) => entry.source);
    expect(sources.some((source) => source?.includes('Internal link only'))).toBe(true);
  });

  it('reports an empty file without errors', () => {
    const empty = parseEnexImport('<en-export></en-export>');
    expect(empty.bookmarks).toHaveLength(0);
    expect(empty.skipped).toHaveLength(0);
    expect(empty.errors).toHaveLength(0);
  });
});
