import { describe, expect, it } from 'bun:test';
import { buildRssFeed, escapeXml, stripIllegalXmlChars } from './rss-builder';

describe('rss-builder', () => {
  it('escapes XML reserved characters and strips illegal XML 1.0 control characters', () => {
    expect(stripIllegalXmlChars('a\x00b\x08c\x0Bd\x0Ce\x1Ff\x7Fg\th\ni\rj')).toBe(
      'abcdefg\th\ni\rj',
    );
    expect(escapeXml(`5 < 6 & "quoted" 'single' > 0\x00`)).toBe(
      '5 &lt; 6 &amp; &quot;quoted&quot; &apos;single&apos; &gt; 0',
    );
  });

  it('builds valid RSS 2.0 XML with collection path title and omits <link> for file items', () => {
    const t1 = new Date('2026-11-14T10:00:00.000Z');
    const t2 = new Date('2026-11-14T09:00:00.000Z');

    const xml = buildRssFeed({
      title: 'Engineering & Research / Rust <2026>',
      link: 'http://localhost:3000/api/v1/public/collections/tok',
      selfUrl: 'http://localhost:3000/api/v1/public/collections/tok/rss',
      description: 'Public feed',
      items: [
        {
          guid: 'urn:arcdrop:item:1',
          title: 'Rust & WebAssembly <Guide>',
          url: 'https://example.com/rust?a=1&b=2',
          excerpt: 'Safe "systems" programming\'s guide',
          tags: ['rust', 'systems'],
          createdAt: t1,
        },
        {
          guid: 'urn:arcdrop:item:2',
          title: 'Uploaded Spec PDF',
          url: null,
          excerpt: null,
          tags: [],
          createdAt: t2,
        },
      ],
    });

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<title>Engineering &amp; Research / Rust &lt;2026&gt;</title>');
    expect(xml).toContain('<link>https://example.com/rust?a=1&amp;b=2</link>');
    expect(xml).toContain(
      '<description>Safe &quot;systems&quot; programming&apos;s guide</description>',
    );
    expect(xml).toContain('<category>rust</category>');
    expect(xml).toContain('<category>systems</category>');
    expect(xml).toContain('<title>Uploaded Spec PDF</title>');
    expect(xml).toContain('<guid isPermaLink="false">urn:arcdrop:item:2</guid>');
    // File item has no <link> tag — only channel <link> and first item <link> appear
    expect(xml.match(/<link>/g)?.length).toBe(2);
    expect(xml).toContain(`<lastBuildDate>${t1.toUTCString()}</lastBuildDate>`);
  });

  it('builds a valid empty RSS 2.0 channel when the collection has no items', () => {
    const now = new Date('2026-11-14T12:00:00.000Z');
    const xml = buildRssFeed({
      title: 'Empty',
      link: 'http://localhost:3000/api/v1/public/collections/tok',
      selfUrl: 'http://localhost:3000/api/v1/public/collections/tok/rss',
      description: 'Empty collection',
      items: [],
      now,
    });
    expect(xml).toContain('<title>Empty</title>');
    expect(xml).toContain(`<lastBuildDate>${now.toUTCString()}</lastBuildDate>`);
    expect(xml).not.toContain('<item>');
  });
});
