/**
 * URL normalization for ArcDrop's duplicates finder (plan M12 / D19, Raindrop parity G10).
 *
 * Rules (URL bookmarks only; file-backed bookmarks arrive in M18):
 * - Scheme is ignored (`http:` and `https:` group together).
 * - Leading `www.` on multi-label hostnames is stripped (`www.example.com` → `example.com`);
 *   non-`www.` subdomains (`docs.example.com`, `blog.example.com`) remain distinct.
 * - Explicit non-default ports are preserved (`:8080`); scheme-default ports (`:80` on http,
 *   `:443` on https) are already null in D12 `urlParts` and omitted.
 * - Trailing slashes on non-root paths are stripped (`/guide/` → `/guide`, `/guide///` → `/guide`);
 *   the root path `/` is preserved (`https://example.com` and `https://example.com/` both → `/`).
 *   Path comparison remains case-sensitive (`/Guide` != `/guide`).
 * - Fragments (`#...`) are stripped.
 * - Tracking query parameters are stripped (case-insensitive):
 *   `utm_*`, `fbclid`, `gclid`, `ref`, `mc_cid`, `mc_eid`.
 * - Remaining query parameters are deterministically sorted by `(key, value)`.
 */

const EXACT_TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'ref', 'mc_cid', 'mc_eid']);

export interface NormalizableUrlParts {
  host: string;
  port: string | null;
  path: string;
  query: string | null;
}

export function isTrackingQueryParam(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || EXACT_TRACKING_PARAMS.has(lower);
}

/**
 * Normalizes D12-decomposed URL parts into a canonical grouping key.
 */
export function normalizeBookmarkParts(parts: NormalizableUrlParts): string {
  let host = parts.host.toLowerCase();
  if (host.startsWith('www.') && host.slice(4).includes('.')) {
    host = host.slice(4);
  }

  const portSegment = parts.port !== null && parts.port !== '' ? `:${parts.port}` : '';

  let path = parts.path === '' ? '/' : parts.path;
  if (path.length > 1) {
    path = path.replace(/\/+$/, '');
    if (path === '') path = '/';
  }

  let querySegment = '';
  if (parts.query !== null && parts.query !== '') {
    const rawParams = new URLSearchParams(parts.query);
    const kept: Array<[string, string]> = [];
    for (const [key, value] of rawParams.entries()) {
      if (!isTrackingQueryParam(key)) {
        kept.push([key, value]);
      }
    }
    if (kept.length > 0) {
      kept.sort((a, b) => {
        if (a[0] < b[0]) return -1;
        if (a[0] > b[0]) return 1;
        if (a[1] < b[1]) return -1;
        if (a[1] > b[1]) return 1;
        return 0;
      });
      querySegment = `?${new URLSearchParams(kept).toString()}`;
    }
  }

  return `${host}${portSegment}${path}${querySegment}`;
}

/**
 * Convenience helper for normalizing an arbitrary absolute URL string using
 * WHATWG URL parsing + the exact `normalizeBookmarkParts` rules.
 */
export function normalizeUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  return normalizeBookmarkParts({
    host: parsed.hostname,
    port: parsed.port === '' ? null : parsed.port,
    path: parsed.pathname,
    query: parsed.search === '' ? null : parsed.search.slice(1),
  });
}
