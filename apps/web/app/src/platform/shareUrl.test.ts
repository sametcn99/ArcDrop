import { describe, expect, it } from 'vitest';
import { extractFirstUrl, parseQuickAddDeepLink } from './shareUrl';

describe('extractFirstUrl', () => {
  it('extracts a bare url', () => {
    expect(extractFirstUrl('https://example.com/article')).toBe('https://example.com/article');
  });

  it('extracts the first url and ignores the rest', () => {
    expect(
      extractFirstUrl('Check https://first.example.com/a and also https://second.example.com/b'),
    ).toBe('https://first.example.com/a');
  });

  it('extracts a url embedded in shared prose and trims trailing punctuation', () => {
    expect(extractFirstUrl('Look! https://arcdrop.dev/post?utm=share — nice.')).toBe(
      'https://arcdrop.dev/post?utm=share',
    );
  });

  it('returns null without an http(s) url', () => {
    expect(extractFirstUrl('just some text')).toBeNull();
    expect(extractFirstUrl('')).toBeNull();
    expect(extractFirstUrl('ftp://files.example.com/x')).toBeNull();
  });
});

describe('parseQuickAddDeepLink', () => {
  it('parses arcdrop://add?url=… into the target url', () => {
    expect(parseQuickAddDeepLink('arcdrop://add?url=https%3A%2F%2Farcdrop.dev%2Fpost')).toBe(
      'https://arcdrop.dev/post',
    );
  });

  it('rejects other schemes and non-http targets', () => {
    expect(parseQuickAddDeepLink('https://arcdrop.dev/add?url=https%3A%2F%2Fx.dev')).toBeNull();
    expect(parseQuickAddDeepLink('arcdrop://add?url=ftp://x.dev/file')).toBeNull();
    expect(parseQuickAddDeepLink('arcdrop://add')).toBeNull();
  });

  it('tolerates unparseable input', () => {
    expect(parseQuickAddDeepLink('not a url')).toBeNull();
  });
});
