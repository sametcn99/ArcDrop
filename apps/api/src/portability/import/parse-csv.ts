import { emptyParsedImport, type ParsedImport } from './import-model';
import { parseCsvRows, splitSemicolonList } from './csv-fields';
import { toIsoOrNull, validateBookmarkItem } from './normalize';

/**
 * Our CSV export columns (the lossy wire format, documented in the README):
 *
 *   url,title,excerpt,note,tags,collections,createdAt,updatedAt
 *
 * - `tags` is a `;`-separated list inside one (quoted) field;
 * - `collections` holds `;`-separated collection paths, each path's
 *   segments joined with `/` — titles containing `/` or `;` cannot round-
 *   trip through CSV (documented lossy);
 * - timestamps are ISO-8601 when present.
 *
 * Rows with an empty `url` cell are errors (with their line number); every
 * other cell is optional. A header row is expected and skipped — its
 * presence is verified loosely (must contain a `url` column).
 */
export function parseCsvImport(text: string): ParsedImport {
  const result = emptyParsedImport();
  const rows = parseCsvRows(text);
  if (rows.length === 0) return result;

  const header = rows[0]!.map((cell) => cell.trim().toLowerCase());
  const column = (name: string): number => header.indexOf(name);
  const urlAt = column('url');
  if (urlAt === -1) {
    result.errors.push({ reason: 'CSV header has no "url" column — not an ArcDrop CSV export' });
    return result;
  }
  const titleAt = column('title');
  const excerptAt = column('excerpt');
  const noteAt = column('note');
  const tagsAt = column('tags');
  const collectionsAt = column('collections');
  const createdAtAt = column('createdat');
  const updatedAtAt = column('updatedat');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    const source = `row ${i + 1}`;
    const cell = (at: number): string | undefined => (at === -1 ? undefined : row[at]?.trim());

    const rawUrl = cell(urlAt);
    if (rawUrl === undefined || rawUrl === '') {
      result.errors.push({ reason: 'url cell is empty', source });
      continue;
    }

    const collectionPaths = splitSemicolonList(cell(collectionsAt))
      .map((path) =>
        path
          .split('/')
          .map((segment) => segment.trim())
          .filter((s) => s !== ''),
      )
      .filter((path) => path.length > 0);

    const validated = validateBookmarkItem(
      {
        url: rawUrl,
        title: cell(titleAt),
        excerpt: cell(excerptAt),
        note: cell(noteAt),
        tags: splitSemicolonList(cell(tagsAt)),
        collectionPaths,
        createdAt: toIsoOrNull(cell(createdAtAt)) ?? null,
        updatedAt: toIsoOrNull(cell(updatedAtAt)) ?? null,
      },
      source,
      result.errors,
    );
    if (validated) result.bookmarks.push(validated);
  }
  return result;
}
