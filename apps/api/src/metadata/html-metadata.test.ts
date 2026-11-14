import { describe, expect, it } from 'bun:test';
import { decodeHtmlEntities, parsePageMetadata } from './html-metadata';

const BASE = 'https://blog.example.com/posts/why';

describe('decodeHtmlEntities', () => {
  it('decodes the common named entities', () => {
    expect(decodeHtmlEntities('A &amp; B &lt;tag&gt; &quot;q&quot; &apos;apos&apos;')).toBe(
      'A & B <tag> "q" \'apos\'',
    );
    expect(decodeHtmlEntities('a&nbsp;b')).toBe('a b');
  });

  it('decodes numeric references (decimal + hex)', () => {
    expect(decodeHtmlEntities('&#65;&#x42;&#X43;')).toBe('ABC');
    expect(decodeHtmlEntities('&#128512;')).toBe('😀');
  });

  it('leaves unknown entities and broken forms alone', () => {
    expect(decodeHtmlEntities('&unknown; stays')).toBe('&unknown; stays');
    expect(decodeHtmlEntities('&#xZZ; stays')).toBe('&#xZZ; stays');
    expect(decodeHtmlEntities('lone & amp')).toBe('lone & amp');
  });

  it('decodes in one pass (no re-scanning of output)', () => {
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;');
  });
});

describe('parsePageMetadata', () => {
  it('extracts title, description, og:image and favicon with relative resolution', () => {
    const html = `
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width">
        <title>  Why ArcDrop &amp; the sync backbone&nbsp;&nbsp; </title>
        <meta name="description" content="A long   explanation &quot;with quotes&quot;.">
        <meta property="og:image" content="/img/cover.png?v=2&amp;h=64">
        <link rel="stylesheet" href="/style.css">
        <link rel="shortcut icon" href="/favicon.ico">
      </head>
      <body>…</body>
      </html>`;
    const parsed = parsePageMetadata(html, BASE);
    expect(parsed.title).toBe('Why ArcDrop & the sync backbone');
    expect(parsed.description).toBe('A long explanation "with quotes".');
    expect(parsed.ogImage).toBe('https://blog.example.com/img/cover.png?v=2&h=64');
    expect(parsed.favicon).toBe('https://blog.example.com/favicon.ico');
  });

  it('uses property= when name= is absent (og tags)', () => {
    const parsed = parsePageMetadata(
      '<meta property="og:image" content="https://cdn.example/x.png">',
      BASE,
    );
    expect(parsed.ogImage).toBe('https://cdn.example/x.png');
  });

  it('accepts single-quoted and unquoted attributes in any order', () => {
    const parsed = parsePageMetadata(
      `<meta content='/desc.jpg' property='og:image'>
       <meta name=description content=unquoted-desc>`,
      BASE,
    );
    expect(parsed.ogImage).toBe('https://blog.example.com/desc.jpg');
    expect(parsed.description).toBe('unquoted-desc');
  });

  it('keeps the FIRST description / og:image occurrence', () => {
    const parsed = parsePageMetadata(
      `<meta name="description" content="first">
       <meta name="description" content="second">
       <meta property="og:image" content="/1.png">
       <meta property="og:image" content="/2.png">`,
      BASE,
    );
    expect(parsed.description).toBe('first');
    expect(parsed.ogImage).toBe('https://blog.example.com/1.png');
  });

  it('picks the first icon link and tolerates apple-touch-icon', () => {
    const parsed = parsePageMetadata(
      `<link rel="apple-touch-icon" href="/apple.png">
       <link rel="icon" href="/icon.svg">`,
      BASE,
    );
    expect(parsed.favicon).toBe('https://blog.example.com/apple.png');
  });

  it('ignores links without an icon rel', () => {
    const parsed = parsePageMetadata('<link rel="stylesheet" href="/s.css">', BASE);
    expect(parsed.favicon).toBeNull();
  });

  it('returns nulls for pages without metadata', () => {
    const parsed = parsePageMetadata('<html><body>plain</body></html>', BASE);
    expect(parsed).toEqual({ title: null, description: null, ogImage: null, favicon: null });
  });

  it('finds a late <title> but never inside attribute values', () => {
    const late = parsePageMetadata(
      `<html><body><div class="title">attribute, not a tag</div><title>late title</title></body></html>`,
      BASE,
    );
    expect(late.title).toBe('late title'); // regex is position-independent — works even outside <head>

    const attribute = parsePageMetadata(
      `<html><body><div class="title">nope</div><span>text</span></body></html>`,
      BASE,
    );
    expect(attribute.title).toBeNull();
  });

  it('maps whitespace-only and empty values to null', () => {
    const parsed = parsePageMetadata(
      `<title>    </title><meta name="description" content="   ">`,
      BASE,
    );
    expect(parsed.title).toBeNull();
    expect(parsed.description).toBeNull();
  });

  it('refuses non-http(s) resolved URLs (javascript: injection)', () => {
    const parsed = parsePageMetadata(
      `<meta property="og:image" content="javascript:alert(1)">
       <link rel="icon" href="data:text/html,x">`,
      BASE,
    );
    expect(parsed.ogImage).toBeNull();
    expect(parsed.favicon).toBeNull();
  });

  it('resolves absolute og:image URLs untouched', () => {
    const parsed = parsePageMetadata(
      '<meta property="og:image" content="https://cdn.example.com/i/cover.jpg">',
      BASE,
    );
    expect(parsed.ogImage).toBe('https://cdn.example.com/i/cover.jpg');
  });

  it('resolves against the FINAL url after redirects (baseUrl is the caller’s concern)', () => {
    const parsed = parsePageMetadata(
      '<meta property="og:image" content="cover.png">',
      'https://real.example.com/final/page',
    );
    expect(parsed.ogImage).toBe('https://real.example.com/final/cover.png');
  });
});
