import { emptyParsedImport, type ParsedImport } from './import-model';
import { attribute, decodeEntities } from './html-text';
import { parseUnixSeconds, validateBookmarkItem } from './normalize';

/**
 * Netscape bookmark file import (`<DL>` format — every browser's "export
 * bookmarks" output, plan M8). Lenient single-pass tokenizer:
 *
 * - `<H3>` names a folder; the following `<DL>` nests into it, `</DL>` pops;
 *   anonymous `<DL>`s (no preceding `<H3>`) contribute no path segment but
 *   stay paired on the stack;
 * - `<DT><A HREF…>` is a bookmark — TAGS is comma-separated, ADD_DATE is
 *   UNIX seconds, and an optional trailing `<DD>` maps to the note;
 * - attributes are case-insensitive and order-free; text is entity-decoded;
 * - unknown tags are skipped; malformed structure heals (an unbalanced
 *   `</DL>` pops an empty stack harmlessly).
 */
export function parseNetscapeImport(html: string): ParsedImport {
  const result = emptyParsedImport();
  const folderStack: string[] = [];
  let pendingFolder: string | null = null;
  // The bookmark whose `<DD>` (if any) has not been seen yet.
  let current: {
    url: string;
    title: string | null;
    tags: string[];
    note?: string;
    createdAt?: string;
  } | null = null;

  const flush = (): void => {
    if (current === null) return;
    const bookmark = current;
    current = null;
    const source = `bookmark "${bookmark.title ?? bookmark.url}"`;
    const validated = validateBookmarkItem(
      {
        url: bookmark.url,
        title: bookmark.title,
        tags: bookmark.tags,
        note: bookmark.note,
        collectionPaths: [folderStack.filter((segment) => segment.length > 0)].filter(
          (path) => path.length > 0,
        ),
        createdAt: bookmark.createdAt ?? null,
      },
      source,
      result.errors,
    );
    if (validated) result.bookmarks.push(validated);
  };

  const token =
    /<dl\b[^>]*>|<\/dl[^>]*>|<dt\s*>\s*<h3([^>]*)>([\s\S]*?)<\/h3\s*>|<dt\s*>\s*<a([^>]*)>([\s\S]*?)<\/a\s*>|<dd\b[^>]*>([\s\S]*?)(?=<|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = token.exec(html)) !== null) {
    const [whole, h3Attrs, h3Text, aAttrs, aText, ddText] = match;
    const lower = whole.toLowerCase();

    if (lower.startsWith('<dl')) {
      flush();
      folderStack.push(pendingFolder ?? '');
      pendingFolder = null;
      continue;
    }
    if (lower.startsWith('</dl')) {
      flush();
      folderStack.pop();
      continue;
    }
    if (h3Attrs !== undefined) {
      flush();
      pendingFolder = decodeEntities(h3Text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      continue;
    }
    if (aAttrs !== undefined) {
      flush();
      const title = decodeEntities(aText ?? '')
        .replace(/\s+/g, ' ')
        .trim();
      current = {
        url: attribute(aAttrs, 'href') ?? '',
        title: title.length > 0 ? title : null,
        tags: (attribute(aAttrs, 'tags') ?? '')
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0),
        createdAt: parseUnixSeconds(attribute(aAttrs, 'add_date')),
      };
      continue;
    }
    if (ddText !== undefined) {
      // The `<DD>` description belongs to the bookmark just parsed.
      if (current !== null) current.note = decodeEntities(ddText).replace(/\s+/g, ' ').trim();
      flush();
      continue;
    }
  }
  flush();

  return result;
}
