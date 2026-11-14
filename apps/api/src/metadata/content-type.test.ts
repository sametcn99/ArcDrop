import { describe, expect, it } from 'bun:test';
import { classifyContentType } from './content-type';

describe('classifyContentType (M10)', () => {
  it('prioritizes response Content-Type over og:type, extension, and host', () => {
    // Response Content-Type wins even on an unclassified path or misleading og:type.
    expect(
      classifyContentType({
        url: 'https://cdn.example/download?id=1',
        responseContentType: 'image/webp; charset=binary',
        ogType: 'article',
      }),
    ).toBe('image');

    expect(
      classifyContentType({
        url: 'https://files.example/media',
        responseContentType: 'video/mp4',
      }),
    ).toBe('video');

    expect(
      classifyContentType({
        url: 'https://files.example/track',
        responseContentType: 'audio/mpeg',
      }),
    ).toBe('audio');

    expect(
      classifyContentType({
        url: 'https://files.example/spec',
        responseContentType: 'application/pdf',
      }),
    ).toBe('document');

    expect(
      classifyContentType({
        url: 'https://files.example/novel',
        responseContentType: 'application/epub+zip',
      }),
    ).toBe('book');
  });

  it('lets text/html fall through to og:type, then extension, then host', () => {
    expect(
      classifyContentType({
        url: 'https://blog.example/post',
        responseContentType: 'text/html; charset=utf-8',
        ogType: 'article',
      }),
    ).toBe('article');

    expect(
      classifyContentType({
        url: 'https://clips.example/watch',
        responseContentType: 'text/html',
        ogType: 'video.other',
      }),
    ).toBe('video');

    expect(
      classifyContentType({
        url: 'https://books.example/title',
        responseContentType: 'text/html',
        ogType: 'books.book',
      }),
    ).toBe('book');

    // `website` falls through to extension / host / link.
    expect(
      classifyContentType({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        responseContentType: 'text/html',
        ogType: 'website',
      }),
    ).toBe('video');

    expect(
      classifyContentType({
        url: 'https://plain.example/home',
        responseContentType: 'text/html',
        ogType: 'website',
      }),
    ).toBe('link');
  });

  it('classifies by URL file extension when headers/og:type are absent or generic', () => {
    expect(classifyContentType({ url: 'https://example.com/pic.png?w=800' })).toBe('image');
    expect(classifyContentType({ url: 'https://example.com/clip.mp4' })).toBe('video');
    expect(classifyContentType({ url: 'https://example.com/podcast.mp3' })).toBe('audio');
    expect(classifyContentType({ url: 'https://example.com/paper.pdf' })).toBe('document');
    expect(classifyContentType({ url: 'https://example.com/book.epub' })).toBe('book');
  });

  it('classifies by known host patterns as last heuristic before link', () => {
    expect(classifyContentType({ url: 'https://www.youtube.com/watch?v=123' })).toBe('video');
    expect(classifyContentType({ url: 'https://youtu.be/123' })).toBe('video');
    expect(classifyContentType({ url: 'https://vimeo.com/123' })).toBe('video');
    expect(classifyContentType({ url: 'https://open.spotify.com/track/123' })).toBe('audio');
    expect(classifyContentType({ url: 'https://artist.bandcamp.com/album/x' })).toBe('audio');
    expect(classifyContentType({ url: 'https://i.imgur.com/abc' })).toBe('image');
    expect(classifyContentType({ url: 'https://www.goodreads.com/book/show/1' })).toBe('book');
    expect(classifyContentType({ url: 'https://engineering.substack.com/p/notes' })).toBe(
      'article',
    );
    expect(classifyContentType({ url: 'https://dev.to/author/post' })).toBe('article');
  });

  it('defaults unclassified URLs and text/plain to link', () => {
    expect(classifyContentType({ url: 'https://example.com/unclassified' })).toBe('link');
    expect(
      classifyContentType({
        url: 'https://example.com/plain',
        responseContentType: 'text/plain',
      }),
    ).toBe('link');
  });
});
