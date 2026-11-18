import { afterEach, describe, expect, it } from 'bun:test';
import { collectPageMeta } from './pageImages';

/** Minimal DOM stand-in covering everything collectPageMeta touches. */
function fakeDocument(options: {
  metas: Record<string, string>;
  baseURI: string;
  images: Array<{ src: string; currentSrc?: string }>;
}): Document {
  const document = {
    baseURI: options.baseURI,
    querySelector: (selector: string): HTMLMetaElement | null => {
      const match = /meta\[(?:property|name)="([^"]+)"\]/.exec(selector);
      const key = match?.[1];
      if (key === undefined || !(key in options.metas)) return null;
      return {
        getAttribute: (name: string) => (name === 'content' ? options.metas[key] : null),
      } as unknown as HTMLMetaElement;
    },
    images: options.images.map((image) => ({
      src: image.src,
      currentSrc: image.currentSrc ?? image.src,
    })),
  };
  return document as unknown as Document;
}

const ORIGINAL_DOCUMENT = globalThis.document;

afterEach(() => {
  // Restore the real (or absent) global between tests.
  Object.defineProperty(globalThis, 'document', {
    value: ORIGINAL_DOCUMENT,
    configurable: true,
    writable: true,
  });
});

function withDocument(document: Document): void {
  Object.defineProperty(globalThis, 'document', {
    value: document,
    configurable: true,
    writable: true,
  });
}

describe('collectPageMeta', () => {
  it('reads og meta and de-duplicates absolute image sources', () => {
    withDocument(
      fakeDocument({
        metas: {
          'og:title': 'An Article',
          'og:description': 'Short summary',
          'og:image': '/lead.jpg',
        },
        baseURI: 'https://example.com/posts/1',
        images: [
          { src: 'https://example.com/lead.jpg' },
          {
            src: 'https://cdn.example.com/pic.png',
            currentSrc: 'https://cdn.example.com/pic@2x.png',
          },
          { src: 'https://example.com/lead.jpg' },
        ],
      }),
    );
    const meta = collectPageMeta();
    expect(meta.ogTitle).toBe('An Article');
    expect(meta.ogDescription).toBe('Short summary');
    expect(meta.ogImage).toBe('https://example.com/lead.jpg');
    expect(meta.images).toEqual([
      'https://example.com/lead.jpg',
      'https://cdn.example.com/pic@2x.png',
    ]);
  });

  it('falls back to the description meta and skips non-http sources', () => {
    withDocument(
      fakeDocument({
        metas: { description: 'Plain description' },
        baseURI: 'https://example.com/',
        images: [
          { src: 'data:image/png;base64,xxxx' },
          { src: 'javascript:void(0)' },
          { src: 'https://example.com/ok.gif' },
        ],
      }),
    );
    const meta = collectPageMeta();
    expect(meta.ogTitle).toBeNull();
    expect(meta.ogDescription).toBe('Plain description');
    expect(meta.ogImage).toBeNull();
    expect(meta.images).toEqual(['https://example.com/ok.gif']);
  });
});
