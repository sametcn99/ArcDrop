import { MAX_TAG_NAME_LENGTH, MAX_TAGS_PER_BOOKMARK } from '@api/bookmarks/bookmarks.dto';
import type { ImportNote, ParsedBookmark } from './import-model';

/**
 * Field caps mirrored from the wire DTOs (`bookmarks.dto.ts`). Import items
 * do not travel as DTO instances — they come from files — so the upsert
 * pipeline enforces the same bounds HERE and reports violations per item
 * instead of failing the whole upload.
 */
export const IMPORT_MAX_URL_LENGTH = 2048;
export const IMPORT_MAX_TITLE_LENGTH = 512;
export const IMPORT_MAX_EXCERPT_LENGTH = 2000;
export const IMPORT_MAX_NOTE_LENGTH = 10_000;

/**
 * Checks one parsed bookmark against the wire caps. Returns `null` when the
 * item is unusable (the reason has been pushed into `errors`); otherwise the
 * item is returned trimmed of outer whitespace in its text fields.
 */
export function validateBookmarkItem(
  item: ParsedBookmark,
  source: string,
  errors: ImportNote[],
): ParsedBookmark | null {
  const fail = (reason: string): null => {
    errors.push({ reason, source });
    return null;
  };

  const url = item.url.trim();
  if (url.length === 0) return fail('url is empty');
  if (url.length > IMPORT_MAX_URL_LENGTH) {
    return fail(`url exceeds ${IMPORT_MAX_URL_LENGTH} characters`);
  }
  // Mirror UrlDecompositionService's acceptance rules (D12) at parse time so
  // the upsert stage never meets an unparseable URL mid-transaction.
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return fail('url must include a host');
  } catch {
    return fail('url must be a valid absolute URL');
  }

  const tags = (item.tags ?? []).map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  // First-spelling-wins dedupe, case-insensitively — mirrors the tag rules
  // the domain applies at write time.
  const deduped: string[] = [];
  for (const tag of tags) {
    if (!deduped.some((kept) => kept.toLowerCase() === tag.toLowerCase())) deduped.push(tag);
  }
  if (deduped.length > MAX_TAGS_PER_BOOKMARK) {
    return fail(`more than ${MAX_TAGS_PER_BOOKMARK} tags on one bookmark`);
  }
  if (deduped.some((tag) => tag.length > MAX_TAG_NAME_LENGTH)) {
    return fail(`a tag name exceeds ${MAX_TAG_NAME_LENGTH} characters`);
  }

  const text = (value: string | null | undefined): string | null => {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const title = text(item.title);
  const excerpt = text(item.excerpt);
  const note = text(item.note);
  if (title !== null && title.length > IMPORT_MAX_TITLE_LENGTH) {
    return fail(`title exceeds ${IMPORT_MAX_TITLE_LENGTH} characters`);
  }
  if (excerpt !== null && excerpt.length > IMPORT_MAX_EXCERPT_LENGTH) {
    return fail(`excerpt exceeds ${IMPORT_MAX_EXCERPT_LENGTH} characters`);
  }
  if (note !== null && note.length > IMPORT_MAX_NOTE_LENGTH) {
    return fail(`note exceeds ${IMPORT_MAX_NOTE_LENGTH} characters`);
  }

  return {
    ...item,
    url,
    title,
    excerpt,
    note,
    tags: deduped.length > 0 ? deduped : undefined,
    collectionPaths: item.collectionPaths?.filter((path) => path.length > 0),
  };
}

/**
 * Lenient timestamp parse: returns the ISO string when parseable,
 * `undefined` when absent or unparseable (callers then fall back to
 * "now" / "database is newer" — import is conservative with garbage dates).
 */
export function toIsoOrNull(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * Evernote timestamps look like `20231118T120000Z` — not ISO, so
 * `Date.parse` refuses them. Returns ISO or undefined.
 */
export function parseEvernoteTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/.exec(value.trim());
  if (!match) {
    const iso = toIsoOrNull(value);
    return iso ?? undefined;
  }
  const [, y, mo, d, h, mi, s] = match;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * Netscape ADD_DATE / LAST_MODIFIED values are UNIX SECONDS (as strings).
 * Returns ISO or undefined for absent/garbage values.
 */
export function parseUnixSeconds(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}
