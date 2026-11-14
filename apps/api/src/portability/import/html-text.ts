/**
 * Lenient HTML/entity helpers shared by the Netscape and ENEX parsers
 * (plan M8). Same philosophy as M6's `html-metadata.ts`: regex-based and
 * forgiving — a missed field beats a parser that crashes on tag soup.
 */

/** Decodes the handful of entities browsers and Evernote actually emit. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Attribute value extraction: double-quoted, single-quoted or bare. */
export function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!match) return undefined;
  return decodeEntities(match[2] ?? match[3] ?? match[4] ?? '').trim();
}
