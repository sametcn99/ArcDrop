import { describe, expect, it } from 'bun:test';
import { createZipBuffer } from '@api/portability/export/zip-writer';
import { extractEpubContent } from './content-extractor';

function buildMinimalEpub(options: {
  title?: string;
  description?: string;
  chapters: Array<{ id: string; href: string; html: string }>;
}): Buffer {
  const manifestItems = options.chapters
    .map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`)
    .join('\n      ');
  const spineItems = options.chapters.map((c) => `<itemref idref="${c.id}"/>`).join('\n      ');

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const opfXml = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    ${options.title ? `<dc:title>${options.title}</dc:title>` : ''}
    ${options.description ? `<dc:description>${options.description}</dc:description>` : ''}
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;

  return createZipBuffer([
    { name: 'mimetype', bytes: Buffer.from('application/epub+zip', 'utf8') },
    { name: 'META-INF/container.xml', bytes: Buffer.from(containerXml, 'utf8') },
    { name: 'OEBPS/content.opf', bytes: Buffer.from(opfXml, 'utf8') },
    ...options.chapters.map((c) => ({
      name: `OEBPS/${c.href}`,
      bytes: Buffer.from(c.html, 'utf8'),
    })),
  ]);
}

describe('extractEpubContent (M18)', () => {
  it('extracts title, description, ordered spine chapters, and strips XSS markup', () => {
    const epub = buildMinimalEpub({
      title: 'Distributed Systems Handbook',
      description: 'Notes on consensus protocols and durable logs.',
      chapters: [
        {
          id: 'ch2',
          href: 'chapters/02-raft.xhtml',
          html: `<html><body><h1>Chapter 2: Raft</h1><p>Leader election guarantees safety.</p></body></html>`,
        },
        {
          id: 'ch1',
          href: 'chapters/01-intro.xhtml',
          html: `<html><body><h1>Chapter 1: Intro</h1><p onclick="evil()">Consensus solves replicated state machines.</p><script>bad()</script></body></html>`,
        },
      ],
    });

    const extracted = extractEpubContent(epub);
    expect(extracted).not.toBeNull();
    expect(extracted!.title).toBe('Distributed Systems Handbook');
    expect(extracted!.excerpt).toBe('Notes on consensus protocols and durable logs.');
    // Follows spine order (ch2 then ch1 in this custom spine)
    expect(extracted!.textContent).toContain('Chapter 2: Raft');
    expect(extracted!.textContent).toContain('Consensus solves replicated state machines.');
    expect(extracted!.textContent.indexOf('Chapter 2')).toBeLessThan(
      extracted!.textContent.indexOf('Chapter 1'),
    );
    expect(extracted!.htmlContent).not.toContain('<script');
    expect(extracted!.htmlContent).not.toContain('onclick');
  });

  it('falls back to lexicographical HTML entries when container.xml is absent and returns null on empty EPUBs', () => {
    const bare = createZipBuffer([
      {
        name: 'text/part1.html',
        bytes: Buffer.from('<html><body><p>Fallback chapter content.</p></body></html>', 'utf8'),
      },
    ]);
    const extracted = extractEpubContent(bare);
    expect(extracted?.textContent).toBe('Fallback chapter content.');

    const empty = createZipBuffer([
      { name: 'mimetype', bytes: Buffer.from('application/epub+zip') },
    ]);
    expect(extractEpubContent(empty)).toBeNull();
    expect(extractEpubContent(Buffer.alloc(0))).toBeNull();
  });
});
