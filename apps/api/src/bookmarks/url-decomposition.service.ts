import { BadRequestException, Injectable } from '@nestjs/common';
import { getDomain } from 'tldts';
import type { UrlParts } from '@api/database/entities/bookmark.entity';

/**
 * URL decomposition (plan D12): parse with the WHATWG URL parser and derive
 * the filterable part columns on every url write. The full URL is stored
 * VERBATIM; these parts are derived, never client-writable, and recomputed
 * whenever the url changes.
 *
 * Part semantics (mirrored by the `bookmarks` columns):
 * - `scheme`   — lowercased scheme (`https`)
 * - `host`     — hostname WITHOUT port, lowercased (WHATWG lowercases it)
 * - `domain`   — Public Suffix List registrable domain via `tldts`
 *                (`www.example.co.uk` → `example.co.uk`), `null` for IP
 *                hosts and single-label names without a known suffix
 * - `port`     — explicit port only; `null` when absent or scheme-default
 * - `path`     — pathname as parsed (`/` minimum for hierarchical urls)
 * - `query`    — query WITHOUT the leading `?`, `null` when absent
 * - `fragment` — fragment WITHOUT the leading `#`, `null` when absent
 */
@Injectable()
export class UrlDecompositionService {
  /**
   * Parses `url` into its parts. Throws a 400 problem (`BAD_REQUEST`) for
   * anything the WHATWG parser rejects — no scheme, bare host, garbage.
   */
  decompose(url: string): UrlParts {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('url must be a valid absolute URL');
    }
    if (!parsed.hostname) {
      // e.g. `mailto:` — parsed fine but has no host component.
      throw new BadRequestException('url must include a host');
    }

    return {
      scheme: parsed.protocol.replace(/:$/, ''),
      host: parsed.hostname,
      domain: getDomain(parsed.hostname),
      port: parsed.port === '' ? null : parsed.port,
      path: parsed.pathname,
      query: parsed.search === '' ? null : parsed.search.slice(1),
      fragment: parsed.hash === '' ? null : parsed.hash.slice(1),
    };
  }
}
