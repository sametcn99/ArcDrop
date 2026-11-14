/**
 * Page-metadata extraction (plan M6) — pure, dependency-free, unit-tested.
 * Reads `<title>`, `meta[name=description]`, `meta[property=og:image]` and
 * the first `<link rel~=icon>` out of an HTML document, resolving relative
 * URLs against the page's final URL.
 *
 * Deliberately regex-based, not a DOM: the fetcher already capped the body
 * at ~2 MB, head metadata sits in the first bytes of real pages, and a
 * lenient extraction that occasionally misses beats a parser dependency
 * that can crash on tag soup. Every miss is `null` — the pipeline treats
 * null as "field stays as-is".
 */

export interface ParsedPageMetadata {
  title: string | null;
  description: string | null;
  /** Absolute URL of `og:image` (null when absent or unresolvable). */
  ogImage: string | null;
  /** Absolute URL of the first icon link (null when absent or unresolvable). */
  favicon: string | null;
}

/** Collapses whitespace, trims, and maps empty → null. */
function cleanText(value: string): string | null {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/**
 * Decodes the HTML entities a title/description realistically carries:
 * the named five plus decimal/hex numeric references. One pass — the
 * decoder never re-scans its own output.
 */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/gi, (match, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code) : match;
      }
      if (entity.startsWith('#')) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 ? safeFromCodePoint(code) : match;
      }
      switch (entity) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        case 'nbsp':
          return ' ';
        default:
          return match;
      }
    })
    .replaceAll('\u0000', ''); // NULs never belong in metadata text
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Reads one attribute off a tag string; returns the decoded value or null. */
function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(
    tag,
  );
  if (!match) return null;
  const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
  return raw === '' ? null : decodeHtmlEntities(raw);
}

/** Resolves `href` against the page URL; null on failure or a non-http(s) result. */
function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(href, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.href;
  } catch {
    return null;
  }
}

export function parsePageMetadata(html: string, baseUrl: string): ParsedPageMetadata {
  const titleMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = titleMatch ? cleanText(decodeHtmlEntities(titleMatch[1] ?? '')) : null;

  let description: string | null = null;
  let ogImage: string | null = null;
  let favicon: string | null = null;

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name'))?.toLowerCase() ?? null;
    const content = attr(tag, 'content');
    if (!key || !content) continue;
    if (key === 'description' && description === null) {
      description = cleanText(content);
    }
    if (key === 'og:image' && ogImage === null) {
      ogImage = resolveUrl(content, baseUrl);
    }
  }

  // First link whose rel marks an icon — covers rel="icon", rel="shortcut
  // icon" and rel="apple-touch-icon" (a hyphenated single token). Relative
  // hrefs resolve against the page; nothing usable → null (the pipeline
  // then tries the conventional /favicon.ico fallback itself).
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase() ?? '';
    const tokens = rel.split(/\s+/);
    if (!tokens.some((token) => token === 'icon' || token.endsWith('-icon'))) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    favicon = resolveUrl(href, baseUrl);
    if (favicon) break;
  }

  return { title, description, ogImage, favicon };
}
