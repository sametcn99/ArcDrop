import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { AppConfigService } from '@api/config/app-config.service';
import { isPrivateAddress, parseIPv4, parseIPv6 } from './private-ip';

/** Response size cap (~2 MB) — applies to the metadata page AND icons. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
/** Whole-walk deadline (~10 s) — DNS, all redirect hops and the body read share it. */
export const FETCH_DEADLINE_MS = 10_000;
/** Redirect cap (ticket: 5). */
export const MAX_REDIRECTS = 5;

/** Content types a metadata (HTML) fetch may return. */
const HTML_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export interface FetchedDocument {
  status: number;
  contentType: string;
  bytes: Uint8Array;
  /** The URL the body was finally served from (redirects resolved) — the base for relative og:image / favicon hrefs. */
  finalUrl: string;
}

/**
 * The failure vocabulary for refused/failed fetches. The metadata pipeline
 * treats EVERY error here as "silent failure" — the bookmark keeps its
 * client-provided data — so the reasons exist for debug logs, not for the
 * wire.
 */
export class MetadataFetchError extends Error {
  constructor(
    /** Stable machine reason, e.g. `private-address-blocked`, `timeout`. */
    readonly reason: string,
    message: string = reason,
  ) {
    super(message);
    this.name = 'MetadataFetchError';
  }
}

type ResolveLike = (hostname: string) => Promise<LookupAddress[]>;
type FetchLike = typeof fetch;

const defaultResolve: ResolveLike = (hostname) => lookup(hostname, { all: true, verbatim: true });

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SecureFetchOptions {
  deadlineMs?: number;
  /** Exact media-type allowlist (checked before any body byte is read). */
  allowedContentTypes?: ReadonlySet<string>;
  /** Prefix allowlist — used for icon fetches (`image/*`). */
  imageOnly?: boolean;
}

/**
 * SSRF-hardened document fetcher (plan M6, ticket M6 — hard requirement):
 *
 * - **DNS is resolved BEFORE connecting** and every resolved address
 *   (IPv4 + IPv6) must be public. Unresolvable or unclassifiable hostnames
 *   fail CLOSED (refused, never waved through).
 * - **Every redirect hop is re-validated** against the same rules — the
 *   `metadata.allowPrivate` test/dev affordance applies ONLY to the
 *   initial url, never to a hop (a redirect target is attacker-chosen).
 * - Redirects capped at 5, one shared ~10 s deadline across the whole
 *   walk, ~2 MB body cap (header AND streamed-read enforced).
 * - Content-type is checked BEFORE the body is downloaded: HTML for
 *   metadata, `image/*` for icons.
 *
 * The transport (`fetch`) and the resolver (`dns.lookup`) are injectable —
 * that is what makes the private-range and redirect-to-private refusals
 * unit-testable without any real network. Known limitation (documented in
 * the README): the OS resolves the hostname a second time for the actual
 * TCP connection, so there is a theoretical DNS-rebinding window; v1
 * accepts it (resolve-then-connect is exactly the ticketed design).
 */
@Injectable()
export class SsrfSafeFetchService {
  private resolveFn: ResolveLike = defaultResolve;
  private fetchFn: FetchLike = fetch;

  constructor(private readonly config: AppConfigService) {}

  /**
   * Test seam: swap in a fake resolver/transport so the private-range and
   * redirect refusals are provable without any real network. Returns this
   * for chaining; production wiring never calls it.
   */
  withDeps(deps: { resolve?: ResolveLike; fetch?: FetchLike }): this {
    if (deps.resolve) this.resolveFn = deps.resolve;
    if (deps.fetch) this.fetchFn = deps.fetch;
    return this;
  }

  /** Fetches an HTML document (metadata scraping). */
  fetchHtml(url: string, opts: SecureFetchOptions = {}): Promise<FetchedDocument> {
    return this.secureFetch(url, { ...opts, allowedContentTypes: HTML_CONTENT_TYPES });
  }

  /** Fetches an image (cover / favicon → icon cache). */
  fetchImage(url: string, opts: SecureFetchOptions = {}): Promise<FetchedDocument> {
    return this.secureFetch(url, { ...opts, imageOnly: true });
  }

  /**
   * The guarded walk. Each hop: validate scheme → resolve DNS → refuse
   * private addresses → fetch (manual redirects) → next hop or body.
   */
  private async secureFetch(url: string, opts: SecureFetchOptions): Promise<FetchedDocument> {
    const { deadlineMs = FETCH_DEADLINE_MS, allowedContentTypes, imageOnly } = opts;
    const deadline = Date.now() + deadlineMs;

    let current = this.validatedUrl(url);
    for (let hop = 0; ; hop++) {
      // The allowPrivate affordance (tests/dev) relaxes ONLY hop 0.
      const strict = !(hop === 0 && this.config.metadataAllowPrivate);
      await this.assertSafeTarget(current, strict);

      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new MetadataFetchError('timeout');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining);
      let response: Response;
      try {
        response = await this.fetchFn(current.href, {
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch (error) {
        clearTimeout(timer);
        const reason = controller.signal.aborted ? 'timeout' : 'network-error';
        throw new MetadataFetchError(
          reason,
          `${reason} fetching ${current.href}: ${(error as Error).message}`,
        );
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        clearTimeout(timer); // this hop is done; the deadline lives on in `deadline`
        const location = response.headers.get('location');
        if (!location) {
          throw new MetadataFetchError(
            'redirect-without-location',
            `no Location on ${response.status} from ${current.href}`,
          );
        }
        if (hop >= MAX_REDIRECTS) {
          throw new MetadataFetchError(
            'too-many-redirects',
            `more than ${MAX_REDIRECTS} redirects`,
          );
        }
        void response.body?.cancel().catch(() => {});
        current = this.validatedUrl(new URL(location, current).href); // relative Location resolved against the CURRENT hop
        continue;
      }

      try {
        // The final hop's abort timer stays armed while the body streams —
        // a stalled body must not hang past the shared deadline.
        if (response.status < 200 || response.status >= 300) {
          void response.body?.cancel().catch(() => {});
          throw new MetadataFetchError(
            'http-status',
            `unusable status ${response.status} from ${current.href}`,
          );
        }
        return await this.readBody(response, current, { allowedContentTypes, imageOnly });
      } finally {
        clearTimeout(timer);
      }
    }
  }

  /** Scheme allowlist (http/https only — no ftp:, no data:, no file:). */
  private validatedUrl(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new MetadataFetchError('invalid-url', `not a URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new MetadataFetchError('scheme-refused', `scheme not allowed: ${parsed.protocol}`);
    }
    return parsed;
  }

  /**
   * Resolves the hop's hostname and refuses unless EVERY resolved address
   * is public. Fail-closed: DNS errors, empty answers and addresses that
   * cannot be classified are all refusals.
   */
  private async assertSafeTarget(url: URL, strict: boolean): Promise<void> {
    const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, ''); // IPv6 literals lose their brackets for lookup
    let addresses: LookupAddress[];
    try {
      addresses = await this.resolveFn(hostname);
    } catch (error) {
      throw new MetadataFetchError(
        'dns-resolution-failed',
        `cannot resolve ${hostname}: ${(error as Error).message}`,
      );
    }
    if (addresses.length === 0) {
      throw new MetadataFetchError('dns-resolution-failed', `no addresses for ${hostname}`);
    }

    for (const { address } of addresses) {
      if (!strict) continue; // test/dev affordance — hop 0 only, DNS itself must still resolve
      if (parseIPv4(address) === null && parseIPv6(address) === null) {
        throw new MetadataFetchError(
          'unclassifiable-address',
          `cannot classify resolved address ${address}`,
        );
      }
      if (isPrivateAddress(address)) {
        throw new MetadataFetchError(
          'private-address-blocked',
          `${hostname} resolves to a private/loopback/link-local address (${address})`,
        );
      }
    }
  }

  /** Header checks, then a capped streamed body read (deadline-aware). */
  private async readBody(
    response: Response,
    url: URL,
    opts: { allowedContentTypes?: ReadonlySet<string>; imageOnly?: boolean },
  ): Promise<FetchedDocument> {
    const contentType =
      (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
    if (opts.allowedContentTypes && !opts.allowedContentTypes.has(contentType)) {
      void response.body?.cancel().catch(() => {}); // free the pooled socket — an unread body pins it
      throw new MetadataFetchError(
        'content-type-refused',
        `content-type not allowed: ${contentType || '(none)'}`,
      );
    }
    if (opts.imageOnly && !contentType.startsWith('image/')) {
      void response.body?.cancel().catch(() => {}); // same
      throw new MetadataFetchError(
        'content-type-refused',
        `content-type not an image: ${contentType || '(none)'}`,
      );
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isInteger(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      void response.body?.cancel().catch(() => {}); // same
      throw new MetadataFetchError(
        'response-too-large',
        `content-length ${contentLength} exceeds the cap`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { status: response.status, contentType, bytes: new Uint8Array(0), finalUrl: url.href };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          throw new MetadataFetchError(
            'response-too-large',
            `body exceeded ${MAX_RESPONSE_BYTES} bytes while streaming`,
          );
        }
        chunks.push(value);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { status: response.status, contentType, bytes, finalUrl: url.href };
  }
}
