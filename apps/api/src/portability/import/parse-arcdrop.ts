import {
  MAX_HIGHLIGHT_COLOR_LENGTH,
  MAX_HIGHLIGHT_NOTE_LENGTH,
  MAX_HIGHLIGHT_TEXT_LENGTH,
} from '@api/bookmarks/bookmarks.dto';
import { CONTENT_TYPES, type ContentType } from '@api/database/entities/bookmark.entity';
import {
  emptyParsedImport,
  type ParsedCollection,
  type ParsedHighlight,
  type ParsedImport,
} from './import-model';
import { toIsoOrNull, validateBookmarkItem } from './normalize';

interface RawJsonRecord {
  [key: string]: unknown;
}

/**
 * ArcDrop JSON import — the round-trip format our exporter writes (plan M8, M10, M18).
 * Shape: `{ format: 'arcdrop/v1', collections: [{ path, title, icon, color,
 * order }], bookmarks: [{ url, title, excerpt, note, favorite, contentType,
 * tags, collections, highlights, createdAt, updatedAt }] }`. `collections`
 * per bookmark are root→leaf SEGMENT ARRAYS (no escaping problems, ids are
 * meaningless across instances). File-backed entries (`storageKind === 'file'` or
 * `url === null`) are recorded in `skipped` because files must be uploaded via
 * `POST /bookmarks/file`.
 */
export function isArcDropJson(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RawJsonRecord)['format'] === 'string' &&
    ((value as RawJsonRecord)['format'] as string).startsWith('arcdrop/')
  );
}

export function parseArcDropDocument(value: unknown): ParsedImport {
  const result = emptyParsedImport();
  if (typeof value !== 'object' || value === null) {
    result.errors.push({ reason: 'JSON document is not an object' });
    return result;
  }
  const doc = value as RawJsonRecord;

  // -- collections ----------------------------------------------------------
  const rawCollections = Array.isArray(doc['collections']) ? doc['collections'] : [];
  for (let i = 0; i < rawCollections.length; i++) {
    const raw = rawCollections[i] as RawJsonRecord | null;
    if (typeof raw !== 'object' || raw === null) {
      result.errors.push({
        reason: 'collection entry is not an object',
        source: `collection ${i + 1}`,
      });
      continue;
    }
    const path = rawPath(raw['path']);
    if (path === null) {
      result.errors.push({
        reason: 'collection has no valid path array',
        source: `collection ${i + 1}`,
      });
      continue;
    }
    const orderRaw = raw['order'];
    const collection: ParsedCollection = {
      path,
      icon: optionalText(raw['icon']),
      color: optionalText(raw['color']),
      order:
        typeof orderRaw === 'number' && Number.isFinite(orderRaw) && orderRaw >= 0
          ? Math.trunc(orderRaw)
          : undefined,
    };
    result.collections.push(collection);
  }

  // -- bookmarks ------------------------------------------------------------
  const rawBookmarks = Array.isArray(doc['bookmarks']) ? doc['bookmarks'] : [];
  for (let i = 0; i < rawBookmarks.length; i++) {
    const raw = rawBookmarks[i] as RawJsonRecord | null;
    const source = `bookmark ${i + 1}`;
    if (typeof raw !== 'object' || raw === null) {
      result.errors.push({ reason: 'bookmark entry is not an object', source });
      continue;
    }

    if (raw['storageKind'] === 'file' || raw['url'] === null) {
      result.skipped.push({
        reason:
          'file-backed bookmarks cannot be imported via URL upsert — re-upload via POST /bookmarks/file',
        source,
      });
      continue;
    }

    const highlights = parseHighlights(raw['highlights'], source, result.errors);
    const favorite = typeof raw['favorite'] === 'boolean' ? raw['favorite'] : undefined;
    const contentTypeRaw = raw['contentType'];
    const contentType =
      typeof contentTypeRaw === 'string' &&
      (CONTENT_TYPES as readonly string[]).includes(contentTypeRaw)
        ? (contentTypeRaw as ContentType)
        : undefined;

    const collectionPaths = Array.isArray(raw['collections'])
      ? (raw['collections'] as unknown[])
          .map((entry) => rawPath(entry))
          .filter((path): path is string[] => path !== null)
      : [];

    const validated = validateBookmarkItem(
      {
        url: typeof raw['url'] === 'string' ? raw['url'] : '',
        title: optionalText(raw['title']),
        excerpt: optionalText(raw['excerpt']),
        note: optionalText(raw['note']),
        favorite,
        contentType,
        tags: Array.isArray(raw['tags'])
          ? raw['tags'].filter((tag): tag is string => typeof tag === 'string')
          : undefined,
        collectionPaths,
        highlights: highlights.length > 0 ? highlights : undefined,
        createdAt:
          toIsoOrNull(typeof raw['createdAt'] === 'string' ? raw['createdAt'] : null) ?? null,
        updatedAt:
          toIsoOrNull(typeof raw['updatedAt'] === 'string' ? raw['updatedAt'] : null) ?? null,
      },
      source,
      result.errors,
    );
    if (validated) result.bookmarks.push(validated);
  }

  return result;
}

function parseHighlights(
  rawList: unknown,
  bookmarkSource: string,
  errors: ParsedImport['errors'],
): ParsedHighlight[] {
  if (!Array.isArray(rawList)) return [];
  const parsed: ParsedHighlight[] = [];
  for (let i = 0; i < rawList.length; i++) {
    const entry = rawList[i] as RawJsonRecord | null;
    const source = `${bookmarkSource} highlight ${i + 1}`;
    if (typeof entry !== 'object' || entry === null) {
      errors.push({ reason: 'highlight entry is not an object', source });
      continue;
    }
    const text = typeof entry['text'] === 'string' ? entry['text'].trim() : '';
    if (text.length === 0) {
      errors.push({ reason: 'highlight text is empty', source });
      continue;
    }
    if (text.length > MAX_HIGHLIGHT_TEXT_LENGTH) {
      errors.push({
        reason: `highlight text exceeds ${MAX_HIGHLIGHT_TEXT_LENGTH} characters`,
        source,
      });
      continue;
    }
    const note = optionalText(entry['note']);
    if (note !== null && note.length > MAX_HIGHLIGHT_NOTE_LENGTH) {
      errors.push({
        reason: `highlight note exceeds ${MAX_HIGHLIGHT_NOTE_LENGTH} characters`,
        source,
      });
      continue;
    }
    const color = optionalText(entry['color']);
    if (color !== null && color.length > MAX_HIGHLIGHT_COLOR_LENGTH) {
      errors.push({
        reason: `highlight color exceeds ${MAX_HIGHLIGHT_COLOR_LENGTH} characters`,
        source,
      });
      continue;
    }
    parsed.push({
      text,
      note,
      color,
      createdAt:
        toIsoOrNull(typeof entry['createdAt'] === 'string' ? entry['createdAt'] : null) ?? null,
    });
  }
  return parsed;
}

/** Reads a path entry: array of non-empty string segments. */
function rawPath(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const path = raw
    .filter((segment): segment is string => typeof segment === 'string')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return path.length > 0 ? path : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
