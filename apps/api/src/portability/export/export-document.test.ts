import { describe, expect, it } from 'bun:test';
import {
  csvField,
  csvRowOf,
  htmlTreeOf,
  renderNetscapeDocument,
  renderTxtChunks,
  type ExportBookmark,
} from './export-document';
import { renderHighlightsCsv, renderHighlightsTxt } from './export-highlights';

const bookmark = (overrides: Partial<ExportBookmark> = {}): ExportBookmark => ({
  url: 'https://x.example/page',
  title: 'Page',
  excerpt: null,
  note: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  tags: [],
  collections: [],
  highlights: [],
  ...overrides,
});

describe('CSV rendering', () => {
  it('quotes fields that contain commas, quotes or newlines', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
  });

  it('joins tags with ; and collections as / paths separated by ;', () => {
    const row = csvRowOf(bookmark({ tags: ['a', 'b'], collections: [['Work', 'Rust'], ['Play']] }));
    expect(row).toBe(
      'https://x.example/page,Page,,,a;b,Work/Rust;Play,2025-01-01T00:00:00.000Z,2025-01-02T00:00:00.000Z',
    );
  });
});

describe('Netscape HTML rendering', () => {
  it('renders folders nested and bookmarks inside them', () => {
    const tree = htmlTreeOf(
      [
        { path: ['Dev', 'Rust'], icon: null, color: null, order: 0 },
        { path: ['Dev'], icon: null, color: null, order: 0 },
      ],
      [
        bookmark({ url: 'https://deep.example/', collections: [['Dev', 'Rust']] }),
        bookmark({ url: 'https://root.example/' }),
      ],
    );
    const html = [...renderNetscapeDocument(tree)].join('');
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
    expect(html).toContain('<DT><H3>Dev</H3>');
    expect(html).toContain('<DT><H3>Rust</H3>');
    expect(html).toContain('<A HREF="https://deep.example/" ADD_DATE="1735689600">');
    expect(html).toContain('<A HREF="https://root.example/"');
    // Unassigned bookmarks stay at the root level (inside the outer DL).
    expect(html.indexOf('https://root.example/')).toBeGreaterThan(
      html.indexOf('</DL><p>', html.indexOf('Rust')),
    );
  });

  it('escapes html-significant characters', () => {
    const tree = htmlTreeOf(
      [{ path: ['A<B & "C"'], icon: null, color: null, order: 0 }],
      [bookmark({ title: '<script>', url: 'https://x.example/?a=1&b=2' })],
    );
    const html = [...renderNetscapeDocument(tree)].join('');
    expect(html).toContain('A&lt;B &amp; &quot;C&quot;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('places a bookmark under its first (sorted) collection only', () => {
    const tree = htmlTreeOf(
      [
        { path: ['A'], icon: null, color: null, order: 0 },
        { path: ['B'], icon: null, color: null, order: 0 },
      ],
      [bookmark({ collections: [['B'], ['A']] })],
    );
    const html = [...renderNetscapeDocument(tree)].join('');
    expect(html.match(/<DT><A /g)).toHaveLength(1);
  });

  it('emits TAGS when present', () => {
    const tree = htmlTreeOf([], [bookmark({ tags: ['one', 'two'] })]);
    const document = [...renderNetscapeDocument(tree)].join('');
    expect(document).toContain('TAGS="one,two"');
  });
});

describe('TXT rendering (G3)', () => {
  it('one url per line with a trailing newline', () => {
    const text = [...renderTxtChunks([bookmark(), bookmark({ url: 'https://y.example/' })])].join(
      '',
    );
    expect(text).toBe('https://x.example/page\nhttps://y.example/\n');
  });
});

describe('highlights rendering (G4 contract)', () => {
  it('txt: quoted blocks with optional notes, blank-line separated', () => {
    const text = renderHighlightsTxt([
      {
        text: 'quoted sentence',
        note: 'my thought',
        color: null,
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      { text: 'second', note: null, color: null, createdAt: '2025-01-01T00:00:00.000Z' },
    ]);
    expect(text).toBe('"quoted sentence"\n- note: my thought\n\n"second"\n');
  });

  it('txt: empty until M10 storage lands — empty string', () => {
    expect(renderHighlightsTxt([])).toBe('');
  });

  it('csv: header always present, rows quoted when needed', () => {
    const csv = renderHighlightsCsv([
      { text: 'has, comma', note: null, color: 'yellow', createdAt: '2025-01-01T00:00:00.000Z' },
    ]);
    expect(csv).toBe(
      'text,note,color,createdAt\r\n"has, comma",,yellow,2025-01-01T00:00:00.000Z\r\n',
    );
  });
});
