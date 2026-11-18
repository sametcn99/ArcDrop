import { describe, expect, it } from 'bun:test';
import {
  appendSelectionToExcerpt,
  dedupeTabs,
  deriveLinkTitle,
  filenameFromImageUrl,
  isHttpUrl,
  summarizeSaveOutcomes,
  type SaveOutcome,
} from './menuActions';

describe('dedupeTabs', () => {
  it('drops duplicate URLs (first occurrence wins) and counts them', () => {
    const result = dedupeTabs([
      { url: 'https://a.example/1', title: 'A1' },
      { url: 'https://b.example/2', title: 'B' },
      { url: 'https://a.example/1', title: 'A1 again' },
    ]);
    expect(result.unique.map((tab) => tab.url)).toEqual([
      'https://a.example/1',
      'https://b.example/2',
    ]);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it('filters out non-http pages entirely', () => {
    const result = dedupeTabs([
      { url: 'chrome://newtab', title: 'New tab' },
      { url: 'https://a.example/1', title: 'A' },
      { url: 'chrome-extension://abc/popup/index.html', title: 'Popup' },
    ]);
    expect(result.unique.map((tab) => tab.url)).toEqual(['https://a.example/1']);
    expect(result.duplicatesRemoved).toBe(0);
  });
});

describe('isHttpUrl', () => {
  it('accepts http(s) only', () => {
    expect(isHttpUrl('https://a.example')).toBe(true);
    expect(isHttpUrl('ftp://a.example')).toBe(false);
  });
});

describe('deriveLinkTitle', () => {
  it('prefers the selection text (the link label)', () => {
    expect(deriveLinkTitle('https://a.example/x', '  Read the docs  ')).toBe('Read the docs');
  });

  it('summarizes host + last path segment otherwise', () => {
    expect(deriveLinkTitle('https://docs.example/guide/getting-started.html')).toBe(
      'docs.example — getting started',
    );
    expect(deriveLinkTitle('https://a.example/')).toBe('a.example');
  });

  it('falls back to the URL for junk input', () => {
    expect(deriveLinkTitle('not a url')).toBe('not a url');
  });
});

describe('appendSelectionToExcerpt', () => {
  it('uses the selection when no excerpt exists', () => {
    expect(appendSelectionToExcerpt(null, ' Highlight ')).toEqual({
      excerpt: 'Highlight',
      changed: true,
    });
  });

  it('appends with a separator to an existing excerpt', () => {
    expect(appendSelectionToExcerpt('Summary', 'Quote')).toEqual({
      excerpt: 'Summary\n\n— Quote',
      changed: true,
    });
  });

  it('is idempotent when the excerpt already contains the selection', () => {
    expect(appendSelectionToExcerpt('Summary\n\n— Quote', 'Quote')).toEqual({
      excerpt: 'Summary\n\n— Quote',
      changed: false,
    });
  });

  it('never writes an empty selection', () => {
    expect(appendSelectionToExcerpt('Summary', '   ')).toEqual({
      excerpt: 'Summary',
      changed: false,
    });
    expect(appendSelectionToExcerpt(null, '   ')).toEqual({ excerpt: '', changed: false });
  });
});

describe('summarizeSaveOutcomes', () => {
  it('buckets outcomes and reports duplicates', () => {
    const outcomes: SaveOutcome[] = [
      { status: 'saved', url: 'a' },
      { status: 'already-saved', url: 'b' },
      { status: 'saved', url: 'c' },
      { status: 'failed', url: 'd' },
    ];
    expect(summarizeSaveOutcomes(outcomes, 2)).toEqual({
      saved: 2,
      skipped: 1,
      failed: 1,
      duplicatesRemoved: 2,
    });
  });
});

describe('filenameFromImageUrl', () => {
  it('keeps the URL basename and adds the mime-derived extension', () => {
    expect(filenameFromImageUrl('https://a.example/pics/cat', 'image/png')).toBe('cat.png');
    expect(filenameFromImageUrl('https://a.example/pic.jpeg', 'image/jpeg')).toBe('pic.jpeg');
  });

  it('falls back to image.png', () => {
    expect(filenameFromImageUrl('https://a.example/', 'image/gif')).toBe('image.gif');
  });
});
