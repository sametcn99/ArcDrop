import { describe, expect, it } from 'bun:test';
import { AppConfigService } from '@api/config/app-config.service';
import type { LookupAddress } from 'node:dns';
import { MAX_REDIRECTS, MetadataFetchError, SsrfSafeFetchService } from './ssrf-fetch.service';

/**
 * The SSRF refusal matrix, unit-tested against an INJECTED resolver and
 * transport — no real network. The private-address cases here are exactly
 * the ticket's mandatory list; the e2e suite re-proves the same refusals
 * over real HTTP against loopback stub servers.
 */

const config = (allowPrivate: boolean): AppConfigService =>
  ({
    metadataAllowPrivate: allowPrivate,
    metadataEnabled: true,
  }) as unknown as AppConfigService;

const addr = (ip: string): LookupAddress => ({
  address: ip,
  family: ip.includes(':') ? 6 : 4,
});

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

const makeFetcher = (options: {
  allowPrivate?: boolean;
  dns: Record<string, string[]>; // hostname → resolved addresses (absent = ENOTFOUND)
  route: Route;
}) =>
  new SsrfSafeFetchService(config(options.allowPrivate ?? false)).withDeps({
    resolve: async (hostname) => {
      const ips = options.dns[hostname];
      if (!ips) {
        throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
      }
      return ips.map(addr);
    },
    fetch: ((url: string | URL | Request, init?: RequestInit) =>
      options.route(String(url), init)) as unknown as typeof fetch,
  });

const htmlResponse = (
  body = '<html><title>ok</title></html>',
  contentType = 'text/html',
): Response => new Response(body, { status: 200, headers: { 'content-type': contentType } });

const PNG_BYTES = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

describe('SsrfSafeFetchService', () => {
  it('fetches a public host and returns the document', async () => {
    const fetcher = makeFetcher({
      dns: { 'example.test': ['93.184.216.34'] },
      route: () => htmlResponse(),
    });
    const doc = await fetcher.fetchHtml('http://example.test/page');
    expect(doc.status).toBe(200);
    expect(doc.contentType).toBe('text/html');
    expect(doc.finalUrl).toBe('http://example.test/page');
    expect(new TextDecoder().decode(doc.bytes)).toContain('ok');
  });

  it('refuses non-http(s) schemes before any DNS work', async () => {
    const fetcher = makeFetcher({
      dns: {},
      route: () => htmlResponse(),
    });
    for (const url of ['ftp://example.test/x', 'file:///etc/passwd', 'data:text/html,x']) {
      const error = await fetcher.fetchHtml(url).catch((e: MetadataFetchError) => e);
      expect(error).toBeInstanceOf(MetadataFetchError);
      expect((error as MetadataFetchError).reason).toBe('scheme-refused');
    }
  });

  it('refuses unresolvable hostnames (fail closed)', async () => {
    const fetcher = makeFetcher({
      dns: {}, // nothing resolves
      route: () => htmlResponse(),
    });
    const error = await fetcher
      .fetchHtml('http://missing.example.test/x')
      .catch((e: MetadataFetchError) => e);
    expect((error as MetadataFetchError).reason).toBe('dns-resolution-failed');
  });

  it('refuses when DNS answers but the address cannot be classified', async () => {
    const fetcher = makeFetcher({
      dns: { 'weird.example.test': ['not-an-ip'] },
      route: () => htmlResponse(),
    });
    const error = await fetcher
      .fetchHtml('http://weird.example.test/x')
      .catch((e: MetadataFetchError) => e);
    expect((error as MetadataFetchError).reason).toBe('unclassifiable-address');
  });

  it('refuses a url whose host resolves to a private address (IPv4 + IPv6 matrix)', async () => {
    const privateAddresses = [
      '127.0.0.1',
      '127.8.8.8',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.77',
      '169.254.169.254',
      '0.0.0.0',
      '::1',
      '::',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
    ];
    for (const ip of privateAddresses) {
      const fetcher = makeFetcher({
        dns: { 'target.example.test': [ip] },
        route: () => htmlResponse(),
      });
      const error = await fetcher
        .fetchHtml('http://target.example.test/x')
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('private-address-blocked');
    }
  });

  it('refuses when ANY resolved address is private (mixed answers)', async () => {
    const fetcher = makeFetcher({
      dns: { 'rebind.example.test': ['93.184.216.34', '10.0.0.1'] },
      route: () => htmlResponse(),
    });
    const error = await fetcher
      .fetchHtml('http://rebind.example.test/x')
      .catch((e: MetadataFetchError) => e);
    expect((error as MetadataFetchError).reason).toBe('private-address-blocked');
  });

  describe('redirect hops', () => {
    const redirect = (location: string): Response =>
      new Response(null, { status: 302, headers: { location } });

    it('follows a public redirect chain and re-resolves each hop', async () => {
      const requested: string[] = [];
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'], 'b.example.test': ['8.8.8.8'] },
        route: (url) => {
          requested.push(url);
          return url === 'http://a.example.test/start'
            ? redirect('http://b.example.test/end')
            : htmlResponse();
        },
      });
      const doc = await fetcher.fetchHtml('http://a.example.test/start');
      expect(requested).toEqual(['http://a.example.test/start', 'http://b.example.test/end']);
      expect(doc.finalUrl).toBe('http://b.example.test/end');
    });

    it('refuses a public host that redirects to a private address', async () => {
      const fetcher = makeFetcher({
        dns: {
          'public.example.test': ['93.184.216.34'],
          'internal.example.test': ['169.254.169.254'],
        },
        route: (url) =>
          url === 'http://public.example.test/x'
            ? redirect('http://internal.example.test/creds')
            : htmlResponse(),
      });
      const error = await fetcher
        .fetchHtml('http://public.example.test/x')
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('private-address-blocked');
    });

    it('applies the strict rules to hops EVEN when allowPrivate relaxed the first target', async () => {
      // The e2e seam: hop 0 may be loopback in test boots, but a redirect
      // target is attacker-chosen and is ALWAYS validated.
      const fetcher = makeFetcher({
        allowPrivate: true,
        dns: { '127.0.0.1': ['127.0.0.1'] },
        route: (url) =>
          url === 'http://127.0.0.1:8080/x'
            ? redirect('http://127.0.0.1:9999/secret')
            : htmlResponse(),
      });
      const error = await fetcher
        .fetchHtml('http://127.0.0.1:8080/x')
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('private-address-blocked');
    });

    it(`caps redirects at ${MAX_REDIRECTS}`, async () => {
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'], 'b.example.test': ['8.8.4.4'] },
        route: (url) =>
          redirect(
            url === 'http://a.example.test/1'
              ? 'http://b.example.test/2'
              : 'http://a.example.test/1',
          ),
      });
      const error = await fetcher
        .fetchHtml('http://a.example.test/1')
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('too-many-redirects');
    });

    it('allows a chain of exactly MAX_REDIRECTS hops', async () => {
      // 5 redirects then a real answer — must succeed.
      const hops = [
        'http://a.example.test/1',
        'http://a.example.test/2',
        'http://a.example.test/3',
        'http://a.example.test/4',
        'http://a.example.test/5',
        'http://a.example.test/end',
      ];
      const start = hops[0]!;
      const last = hops[hops.length - 1]!;
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: (url) =>
          url === last ? htmlResponse() : redirect(hops[hops.indexOf(url) + 1] ?? ''),
      });
      const doc = await fetcher.fetchHtml(start);
      expect(doc.finalUrl).toBe(last);
    });

    it('refuses a redirect to a non-http scheme', async () => {
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: () => redirect('file:///etc/passwd'),
      });
      const error = await fetcher
        .fetchHtml('http://a.example.test/x')
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('scheme-refused');
    });

    it('resolves relative Location headers against the current hop', async () => {
      const requested: string[] = [];
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: (url) => {
          requested.push(url);
          return url === 'http://a.example.test/deep/path'
            ? redirect('/other/place')
            : htmlResponse();
        },
      });
      const doc = await fetcher.fetchHtml('http://a.example.test/deep/path');
      expect(doc.finalUrl).toBe('http://a.example.test/other/place');
    });
  });

  describe('content-type gate', () => {
    it('fetchHtml refuses non-HTML responses without reading the body', async () => {
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: () =>
          new Response('<title>Leak</title>', { headers: { 'content-type': 'text/plain' } }),
      });
      const error = await fetcher
        .fetchHtml('http://a.example.test/x')
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('content-type-refused');
    });

    it('fetchHtml accepts xhtml', async () => {
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: () => htmlResponse('<html/>', 'application/xhtml+xml'),
      });
      const doc = await fetcher.fetchHtml('http://a.example.test/x');
      expect(doc.contentType).toBe('application/xhtml+xml');
    });

    it('fetchResource reads HTML bodies and cancels non-HTML bodies immediately', async () => {
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: (url) =>
          url.endsWith('.png')
            ? new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } })
            : htmlResponse('<title>Article</title>'),
      });
      const htmlDoc = await fetcher.fetchResource('http://a.example.test/article');
      expect(htmlDoc.contentType).toBe('text/html');
      expect(new TextDecoder().decode(htmlDoc.bytes)).toContain('Article');

      const imgDoc = await fetcher.fetchResource('http://a.example.test/photo.png');
      expect(imgDoc.contentType).toBe('image/png');
      expect(imgDoc.bytes.byteLength).toBe(0);
    });

    it('fetchImage refuses non-image responses', async () => {
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: () => new Response('hello', { headers: { 'content-type': 'text/html' } }),
      });
      const error = await fetcher
        .fetchImage('http://a.example.test/icon')
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('content-type-refused');
    });

    it('fetchImage accepts any image/* type', async () => {
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: () => new Response(PNG_BYTES, { headers: { 'content-type': 'image/png' } }),
      });
      const doc = await fetcher.fetchImage('http://a.example.test/icon.png');
      expect(doc.contentType).toBe('image/png');
      expect(doc.bytes.byteLength).toBe(PNG_BYTES.byteLength);
    });
  });

  describe('size caps', () => {
    it('refuses via the content-length header before reading', async () => {
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: () =>
          new Response('x', {
            headers: { 'content-type': 'text/html', 'content-length': String(3 * 1024 * 1024) },
          }),
      });
      const error = await fetcher
        .fetchHtml('http://a.example.test/x')
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('response-too-large');
    });

    it('refuses a streamed body that grows past the cap', async () => {
      const chunk = new Uint8Array(1024 * 1024).fill(0x61); // 1 MiB of 'a'
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 3) {
            controller.close();
            return;
          }
          sent++;
          controller.enqueue(chunk);
        },
      });
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: () => new Response(stream, { headers: { 'content-type': 'text/html' } }),
      });
      const error = await fetcher
        .fetchHtml('http://a.example.test/x')
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('response-too-large');
    });

    it('accepts a streamed body just under the cap', async () => {
      const chunk = new Uint8Array(512 * 1024).fill(0x61);
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= 3) {
            controller.close();
            return;
          }
          sent++;
          controller.enqueue(chunk);
        },
      });
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: () => new Response(stream, { headers: { 'content-type': 'text/html' } }),
      });
      const doc = await fetcher.fetchHtml('http://a.example.test/x');
      expect(doc.bytes.byteLength).toBe(512 * 1024 * 3);
    });
  });

  describe('timeout', () => {
    it('aborts a hanging transport at the deadline', async () => {
      const fetcher = makeFetcher({
        dns: { 'a.example.test': ['93.184.216.34'] },
        route: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('The operation was aborted')),
            );
          }),
      });
      const error = await fetcher
        .fetchHtml('http://a.example.test/x', { deadlineMs: 60 })
        .catch((e: MetadataFetchError) => e);
      expect((error as MetadataFetchError).reason).toBe('timeout');
    });
  });

  it('maps transport errors to network-error', async () => {
    const fetcher = makeFetcher({
      dns: { 'a.example.test': ['93.184.216.34'] },
      route: () => Promise.reject(new Error('connection reset')),
    });
    const error = await fetcher
      .fetchHtml('http://a.example.test/x')
      .catch((e: MetadataFetchError) => e);
    expect((error as MetadataFetchError).reason).toBe('network-error');
  });

  it('refuses non-2xx responses', async () => {
    const fetcher = makeFetcher({
      dns: { 'a.example.test': ['93.184.216.34'] },
      route: () => new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } }),
    });
    const error = await fetcher
      .fetchHtml('http://a.example.test/x')
      .catch((e: MetadataFetchError) => e);
    expect((error as MetadataFetchError).reason).toBe('http-status');
  });
});
