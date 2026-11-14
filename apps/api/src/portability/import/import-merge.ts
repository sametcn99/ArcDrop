import type { ParsedBookmark } from './import-model';

/**
 * The import field-merge decision (plan M8, ratified): LAST-WRITE-WINS on
 * `updatedAt` (plan D4's conflict rule), guarded by two absolutes —
 * empty/absent incoming data never overwrites anything, and a null/empty
 * database field is filled from the item regardless of age.
 *
 * - `itemNewer` is false whenever the item carries no parseable
 *   `updatedAt` (TXT/HTML/Netscape have none) — the database row then wins
 *   every non-empty field and the item only fills gaps.
 * - The url NEVER appears in the patch: it is the match key (D13).
 *
 * Pure function — unit-tested in `import-merge.test.ts`; exercised through
 * `ImportUpsertService.updateBookmark`.
 */
export function pickFieldPatch(
  row: { title: string | null; excerpt: string | null; note: string | null; updatedAt: Date },
  item: ParsedBookmark,
): Partial<Pick<ParsedBookmark, 'title' | 'excerpt' | 'note'>> {
  const itemUpdatedAtMs =
    item.updatedAt !== undefined && item.updatedAt !== null ? Date.parse(item.updatedAt) : null;
  const itemNewer =
    itemUpdatedAtMs !== null &&
    !Number.isNaN(itemUpdatedAtMs) &&
    itemUpdatedAtMs > row.updatedAt.getTime();

  const patch: Partial<Pick<ParsedBookmark, 'title' | 'excerpt' | 'note'>> = {};
  const candidates = [
    ['title', item.title, row.title],
    ['excerpt', item.excerpt, row.excerpt],
    ['note', item.note, row.note],
  ] as const;
  for (const [field, incoming, current] of candidates) {
    if (incoming === null || incoming === undefined) continue; // no data — never touches
    if (current === null || current === '') {
      patch[field] = incoming; // fill-if-empty (the M6 philosophy)
    } else if (itemNewer && incoming !== current) {
      patch[field] = incoming; // last-write-wins (plan D4)
    }
  }
  return patch;
}
