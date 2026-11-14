import { describe, expect, it } from 'bun:test';
import { isTrackingQueryParam, normalizeBookmarkParts, normalizeUrl } from './url-normalize';

describe('url-normalize (M12 duplicates)', () => {
  it('ignores scheme (http vs https) and leading www.', () => {
    expect(normalizeUrl('http://example.com/guide')).toBe(
      normalizeUrl('https://www.example.com/guide'),
    );
    expect(normalizeUrl('https://WWW.Example.COM/guide')).toBe('example.com/guide');
  });

  it('preserves non-www subdomains and treats them as distinct', () => {
    expect(normalizeUrl('https://docs.example.com/guide')).not.toBe(
      normalizeUrl('https://blog.example.com/guide'),
    );
    expect(normalizeUrl('https://www.docs.example.com/guide')).toBe(
      normalizeUrl('http://docs.example.com/guide'),
    );
  });

  it('ignores trailing slashes on non-root paths while preserving root / and path case', () => {
    expect(normalizeUrl('https://example.com/guide/')).toBe(
      normalizeUrl('https://example.com/guide'),
    );
    expect(normalizeUrl('https://example.com/guide///')).toBe('example.com/guide');
    expect(normalizeUrl('https://example.com')).toBe(normalizeUrl('https://example.com/'));
    expect(normalizeUrl('https://example.com')).toBe('example.com/');
    expect(normalizeUrl('https://example.com/Guide')).not.toBe(
      normalizeUrl('https://example.com/guide'),
    );
  });

  it('strips fragments and tracking parameters while sorting remaining query params', () => {
    const a = normalizeUrl(
      'https://www.example.com/article/?utm_source=hn&utm_medium=social&b=2&fbclid=xyz&a=1#comments',
    );
    const b = normalizeUrl(
      'http://example.com/article?a=1&gclid=123&ref=newsletter&mc_cid=c1&mc_eid=e1&b=2#top',
    );
    expect(a).toBe('example.com/article?a=1&b=2');
    expect(b).toBe(a);
  });

  it('identifies tracking parameters case-insensitively', () => {
    for (const key of [
      'utm_source',
      'UTM_CAMPAIGN',
      'utm_custom_anything',
      'fbclid',
      'FBCLID',
      'gclid',
      'ref',
      'mc_cid',
      'mc_eid',
    ]) {
      expect(isTrackingQueryParam(key)).toBe(true);
    }
    for (const key of ['id', 'page', 'q', 'utm', 'reference']) {
      expect(isTrackingQueryParam(key)).toBe(false);
    }
  });

  it('keeps non-tracking query parameters distinct and preserves explicit non-default ports', () => {
    expect(normalizeUrl('https://example.com/item?id=1')).not.toBe(
      normalizeUrl('https://example.com/item?id=2'),
    );
    expect(normalizeUrl('http://example.com:8080/api/')).toBe('example.com:8080/api');
    expect(normalizeUrl('http://example.com:80/api')).toBe(
      normalizeUrl('https://example.com:443/api'),
    );
  });

  it('matches D12 urlParts directly without reparsing scheme or fragment', () => {
    expect(
      normalizeBookmarkParts({
        host: 'www.example.co.uk',
        port: null,
        path: '/docs/intro/',
        query: 'utm_source=rss&z=9&a=1',
      }),
    ).toBe('example.co.uk/docs/intro?a=1&z=9');
  });
});
