import { describe, expect, it } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { UrlDecompositionService } from './url-decomposition.service';

/**
 * URL decomposition contract (plan D12): WHATWG parse + `tldts` registrable
 * domain, verbatim URL storage upstream, the part semantics documented on
 * the service.
 */
describe('UrlDecompositionService', () => {
  const service = new UrlDecompositionService();

  it('decomposes a plain https url', () => {
    expect(service.decompose('https://www.example.com/some/path')).toEqual({
      scheme: 'https',
      host: 'www.example.com',
      domain: 'example.com',
      port: null,
      path: '/some/path',
      query: null,
      fragment: null,
    });
  });

  it('derives the registrable domain through public suffixes', () => {
    expect(service.decompose('https://www.example.co.uk/a').domain).toBe('example.co.uk');
    expect(service.decompose('https://deep.sub.blog.example.org/x').domain).toBe('example.org');
  });

  it('keeps explicit ports and drops scheme-default ones', () => {
    const explicit = service.decompose('http://example.com:8443/index.html');
    expect(explicit.port).toBe('8443');
    expect(explicit.domain).toBe('example.com');

    expect(service.decompose('https://example.com:443/x').port).toBeNull();
    expect(service.decompose('http://example.com:80/x').port).toBeNull();
  });

  it('splits query and fragment without their delimiters', () => {
    const parts = service.decompose('https://example.com/search?q=books&page=2#results');
    expect(parts.query).toBe('q=books&page=2');
    expect(parts.fragment).toBe('results');
  });

  it('keeps the root path and lowercases scheme/host (WHATWG normalization)', () => {
    const parts = service.decompose('HTTPS://EXAMPLE.COM');
    expect(parts.scheme).toBe('https');
    expect(parts.host).toBe('example.com');
    expect(parts.path).toBe('/');
  });

  it('returns null domain for IP hosts and single-label hostnames', () => {
    expect(service.decompose('http://192.168.1.10:8080/app').domain).toBeNull();
    expect(service.decompose('http://localhost:3000/').domain).toBeNull();
    expect(service.decompose('http://192.168.1.10:8080/app').host).toBe('192.168.1.10');
  });

  it('preserves encoded characters in parts (verbatim upstream)', () => {
    const parts = service.decompose('https://example.com/a%20b?q=x%26y#frag%20ment');
    expect(parts.path).toBe('/a%20b');
    expect(parts.query).toBe('q=x%26y');
    expect(parts.fragment).toBe('frag%20ment');
  });

  it('rejects non-urls and hostless schemes with a 400 problem', () => {
    for (const bad of ['not a url', 'example.com', 'ftp:', '']) {
      expect(() => service.decompose(bad)).toThrow(BadRequestException);
    }
    expect(() => service.decompose('mailto:someone@example.com')).toThrow(BadRequestException);
  });
});
