import { emptyParsedImport, type ParsedCollection, type ParsedImport } from './import-model';
import { toIsoOrNull, validateBookmarkItem } from './normalize';

interface RawJsonRecord {
  [key: string]: unknown;
}

/**
 * Raindrop JSON export import (plan M8 — "map raindrop collections/tags
 * into ArcDrop's model"). Recognized shape:
 *
 *   { user: {…}, collections: [{ _id, title, parent?: { $oid } }],
 *     bookmarks/items: [{ title, link, tags: [], collection: {$oid}|{id:-1},
 *                        created, updated, excerpt?, note? }] }
 *
 * Mapping rules:
 * - collections become title PATHS via the `$oid` parent chain — `unsorted`
 *   (`{"id": -1}`) and `broken` (`{"id": -99}`, absent) mean no collection;
 * - `link` is the bookmark URL; `tags` are strings; `created`/`updated` and
 *   `excerpt`/`note` carry over when present;
 * - Raindrop `highlights` entries are NOT imported (ArcDrop highlight
 *   storage lands in M10) and `cover`/`image`/`domain` are server-derived
 *   or cache-related — ignored.
 */
export function isRaindropJson(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const doc = value as RawJsonRecord;
  const items = Array.isArray(doc['bookmarks'])
    ? doc['bookmarks']
    : Array.isArray(doc['items'])
      ? doc['items']
      : null;
  if (items === null) return false;
  // Raindrop items carry `link`; ArcDrop items carry `url`.
  return items.some(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as RawJsonRecord)['link'] === 'string',
  );
}

export function parseRaindropDocument(value: unknown): ParsedImport {
  const result = emptyParsedImport();
  if (typeof value !== 'object' || value === null) {
    result.errors.push({ reason: 'JSON document is not an object' });
    return result;
  }
  const doc = value as RawJsonRecord;

  // -- collections: resolve $oid parent chains into title paths -------------
  const titleById = new Map<string, string>();
  const parentById = new Map<string, string | null>();
  const rawCollections = Array.isArray(doc['collections']) ? doc['collections'] : [];
  for (const raw of rawCollections) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as RawJsonRecord;
    const id = oidOf(entry['_id']);
    const title = typeof entry['title'] === 'string' ? entry['title'].trim() : '';
    if (id === null || title.length === 0) continue;
    titleById.set(id, title);
    // The parent value IS the `{$oid}` reference (Raindrop export shape).
    parentById.set(id, oidOf(entry['parent']));
  }

  const pathOf = (id: string): string[] => {
    const path: string[] = [];
    const visited = new Set<string>();
    let current: string | null = id;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      const title = titleById.get(current);
      if (title !== undefined) path.unshift(title);
      current = parentById.get(current) ?? null;
    }
    return path.filter((segment) => segment.length > 0);
  };

  for (const [id] of titleById) {
    const path = pathOf(id);
    if (path.length > 0) {
      const collection: ParsedCollection = { path };
      result.collections.push(collection);
    }
  }

  // -- bookmarks ------------------------------------------------------------
  const rawItems = Array.isArray(doc['bookmarks'])
    ? doc['bookmarks']
    : Array.isArray(doc['items'])
      ? doc['items']
      : [];
  const collectionPathByOid = new Map<string, string[]>();
  for (const [id] of titleById) collectionPathByOid.set(id, pathOf(id));

  for (let i = 0; i < rawItems.length; i++) {
    const raw = rawItems[i] as RawJsonRecord | null;
    const source = `bookmark ${i + 1}`;
    if (typeof raw !== 'object' || raw === null) {
      result.errors.push({ reason: 'bookmark entry is not an object', source });
      continue;
    }

    const collectionRef = raw['collection'] as RawJsonRecord | undefined;
    const oid = oidOf(collectionRef?.['$oid']);
    const collectionPaths: string[][] = [];
    if (oid !== null) {
      const path = collectionPathByOid.get(oid);
      if (path !== undefined && path.length > 0) collectionPaths.push(path);
    }
    // `{"id": -1}` (unsorted), `{"id": -99}` (broken) and an absent
    // collection all mean "no collection" — nothing to map.

    const highlights = raw['highlights'];
    if (Array.isArray(highlights) && highlights.length > 0) {
      result.skipped.push({
        reason: `Raindrop highlights have no ArcDrop storage yet (M10) — ${highlights.length} highlight(s) skipped`,
        source,
      });
    }

    const tags = Array.isArray(raw['tags'])
      ? raw['tags'].filter((tag): tag is string => typeof tag === 'string')
      : undefined;

    const validated = validateBookmarkItem(
      {
        url: typeof raw['link'] === 'string' ? raw['link'] : '',
        title: optionalText(raw['title']),
        excerpt: optionalText(raw['excerpt']),
        note: optionalText(raw['note']),
        tags,
        collectionPaths,
        createdAt: toIsoOrNull(asString(raw['created'])) ?? null,
        updatedAt: toIsoOrNull(asString(raw['updated'])) ?? null,
      },
      source,
      result.errors,
    );
    if (validated) result.bookmarks.push(validated);
  }

  return result;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function oidOf(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'object' && value !== null) {
    const oid = (value as RawJsonRecord)['$oid'];
    if (typeof oid === 'string' && oid.length > 0) return oid;
  }
  return null;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
