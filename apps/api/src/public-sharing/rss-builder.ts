export interface RssFeedItemInput {
  guid: string;
  title: string | null;
  url: string | null;
  excerpt: string | null;
  tags: readonly string[];
  createdAt: Date;
}

export interface RssFeedInput {
  title: string;
  link: string;
  selfUrl: string;
  description: string;
  items: readonly RssFeedItemInput[];
  now?: Date;
}

/**
 * Renders a valid RSS 2.0 XML document for a publicly shared collection
 * (plan M19 / D19). Strictly accepts only allowlisted public item fields
 * (`title`, `url`, `excerpt`, `tags`, `createdAt`, `guid`) so private notes,
 * highlights, and file payloads can never enter the XML output.
 */
export function buildRssFeed(input: RssFeedInput): string {
  const latestItemDate = input.items[0]?.createdAt ?? input.now ?? new Date();
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${escapeXml(input.title)}</title>`,
    `    <link>${escapeXml(input.link)}</link>`,
    `    <atom:link href="${escapeXml(input.selfUrl)}" rel="self" type="application/rss+xml" />`,
    `    <description>${escapeXml(input.description)}</description>`,
    `    <lastBuildDate>${latestItemDate.toUTCString()}</lastBuildDate>`,
    '    <docs>https://www.rssboard.org/rss-specification</docs>',
    '    <generator>ArcDrop</generator>',
  ];

  for (const item of input.items) {
    const resolvedTitle = item.title?.trim() || item.url?.trim() || 'Untitled';
    lines.push('    <item>');
    lines.push(`      <title>${escapeXml(resolvedTitle)}</title>`);
    if (item.url !== null && item.url.trim() !== '') {
      lines.push(`      <link>${escapeXml(item.url)}</link>`);
    }
    lines.push(`      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`);
    lines.push(`      <pubDate>${item.createdAt.toUTCString()}</pubDate>`);
    if (item.excerpt !== null && item.excerpt.trim() !== '') {
      lines.push(`      <description>${escapeXml(item.excerpt)}</description>`);
    }
    for (const tag of item.tags) {
      if (tag.trim() === '') continue;
      lines.push(`      <category>${escapeXml(tag)}</category>`);
    }
    lines.push('    </item>');
  }

  lines.push('  </channel>');
  lines.push('</rss>', '');
  return lines.join('\n');
}

/**
 * Strips characters illegal or discouraged in XML 1.0 (C0 controls other than
 * tab/LF/CR, DEL U+007F, and U+FFFE/U+FFFF non-characters), then escapes XML
 * reserved characters.
 */
export function stripIllegalXmlChars(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code !== 0x7f && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd)
    ) {
      out += raw[i];
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < raw.length) {
      const next = raw.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += raw[i]! + raw[i + 1]!;
        i++;
      }
    }
  }
  return out;
}

export function escapeXml(raw: string): string {
  return stripIllegalXmlChars(raw)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
