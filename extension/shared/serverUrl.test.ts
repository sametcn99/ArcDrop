import { describe, expect, it } from 'bun:test';
import { normalizeServerUrl } from './serverUrl';

describe('normalizeServerUrl', () => {
  it('defaults scheme-less input to https', () => {
    const result = normalizeServerUrl('arcdrop.example.com');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe('https://arcdrop.example.com');
      expect(result.origin).toBe('https://arcdrop.example.com');
    }
  });

  it('keeps an explicit http scheme and port', () => {
    const result = normalizeServerUrl('http://localhost:3000');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe('http://localhost:3000');
      expect(result.origin).toBe('http://localhost:3000');
    }
  });

  it('strips trailing slashes and keeps a path suffix', () => {
    const result = normalizeServerUrl('https://host.example/arcdrop/');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe('https://host.example/arcdrop');
      expect(result.origin).toBe('https://host.example');
    }
  });

  it('trims surrounding whitespace', () => {
    const result = normalizeServerUrl('  arcdrop.example.com  ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe('https://arcdrop.example.com');
    }
  });

  it('rejects empty input', () => {
    expect(normalizeServerUrl('')).toEqual({ ok: false, reason: 'empty' });
    expect(normalizeServerUrl('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects non-http schemes', () => {
    expect(normalizeServerUrl('ftp://host.example')).toEqual({
      ok: false,
      reason: 'unsupported-scheme',
    });
    expect(normalizeServerUrl('javascript:alert(1)')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects malformed input', () => {
    expect(normalizeServerUrl('http://')).toEqual({ ok: false, reason: 'invalid' });
    expect(normalizeServerUrl('https://host.example:port')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});
