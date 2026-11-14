import { emptyParsedImport, type ParsedImport } from './import-model';
import { decodeEntities } from './html-text';
import { parseEvernoteTimestamp, validateBookmarkItem } from './normalize';

/**
 * ENEX (Evernote export) import — WEB CLIPS ONLY (Raindrop parity G3).
 *
 * ENEX has no explicit "web clip" marker: a web-clip note is one whose
 * content carries an external http(s) link (the clipped page). The parser
 * takes the FIRST external link as the source URL; notes without any
 * external link are regular notes — skipped and counted (ticket), with
 * their titles as the reason's source.
 *
 * Tags come from `<tag>` elements, `created` (Evernote's
 * `20231118T120000Z` stamp) is preserved as the bookmark's createdAt.
 * Everything else in a note (images, formatted body text, attachments) is
 * ignored — a web clip reduces to (url, title, tags, created).
 *
 * Lenient by construction: `<note>…</note>` blocks are scanned textually,
 * the same tag-soup philosophy as the Netscape parser.
 */
export function parseEnexImport(xml: string): ParsedImport {
  const result = emptyParsedImport();

  const noteBlock = /<note\b[^>]*>([\s\S]*?)<\/note\s*>/gi;
  let block: RegExpExecArray | null;
  let index = 0;
  while ((block = noteBlock.exec(xml)) !== null) {
    index++;
    const source = `note ${index}`;
    const note = block[1] ?? '';

    const title = decodeEntities(singleValue(note, 'title') ?? '').trim();
    const created = parseEvernoteTimestamp(singleValue(note, 'created'));

    const tags = collectValues(note, 'tag')
      .map((tag) => decodeEntities(tag).trim())
      .filter((tag) => tag.length > 0);

    // First external http(s) link in the note content = the clipped page.
    const link =
      /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')([^>]*)>([\s\S]*?)<\/a\s*>/i.exec(note) ?? null;
    let url: string | null = null;
    if (link !== null) {
      const href = decodeEntities(link[2] ?? link[3] ?? '').trim();
      if (/^https?:\/\//i.test(href)) url = href;
    }

    if (url === null) {
      result.skipped.push({
        reason: 'regular note without an external link — web clips only',
        source: title.length > 0 ? `${source} "${title}"` : source,
      });
      continue;
    }

    const validated = validateBookmarkItem(
      {
        url,
        title: title.length > 0 ? title : null,
        tags: tags.length > 0 ? tags : undefined,
        createdAt: created ?? null,
      },
      source,
      result.errors,
    );
    if (validated) result.bookmarks.push(validated);
  }
  return result;
}

/** Text of the FIRST `<name>value</name>` element (no attributes). */
function singleValue(scope: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}\\s*>`, 'i').exec(scope);
  return match?.[1];
}

/** Texts of EVERY `<name>value</name>` element. */
function collectValues(scope: string, name: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}\\s*>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(scope)) !== null) values.push(match[1] ?? '');
  return values;
}
