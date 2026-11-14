/**
 * The normalized shape every import parser produces (plan M8, M10). Parsers
 * are pure: bytes/format text in → `ParsedImport` out, no database access,
 * no I/O. The upsert engine (`import-upsert.service.ts`) consumes the
 * result.
 *
 * Parser-level "skips" (ENEX regular notes, Raindrop highlights, unsupported
 * ZIP members, …) are collected WITH reasons during parsing — the ticket
 * requires skipped rows to carry a reason. Per-item validation failures
 * (invalid URL, oversized fields, bad tag names) also land in `errors` at
 * parse time, so the upsert stage only ever sees structurally valid items.
 */
import type { ContentType } from '@api/database/entities/bookmark.entity';

/** One entry of the `skipped` / `errors` arrays — a reason, optionally sourced. */
export interface ImportNote {
  /** Human-readable reason (stable wording, asserted by tests). */
  reason: string;
  /** Where the entry came from, e.g. `archive.zip/links.enex note 3`. */
  source?: string;
}

/** A collection to ensure, addressed by its root→leaf title path. */
export interface ParsedCollection {
  path: string[];
  icon?: string | null;
  color?: string | null;
  /** Explicit sibling position (ArcDrop JSON round-trips preserve it). */
  order?: number;
}

/** One highlight candidate on an imported ArcDrop JSON bookmark. */
export interface ParsedHighlight {
  text: string;
  note?: string | null;
  color?: string | null;
  createdAt?: string | null;
}

/** One bookmark candidate after normalization. All fields are optional
 * except `url`; absent fields never overwrite anything (fill-in semantics
 * live in the upsert engine). */
export interface ParsedBookmark {
  url: string;
  title?: string | null;
  excerpt?: string | null;
  note?: string | null;
  favorite?: boolean;
  contentType?: ContentType;
  /** Tag NAMES (not ids) — resolved through the normal tag rules. */
  tags?: string[];
  /** Each membership as a root→leaf title path. */
  collectionPaths?: string[][];
  /** Highlight entries (ArcDrop JSON round-trip, M10). */
  highlights?: ParsedHighlight[];
  /** ISO-8601 or null — preserved on CREATE, never restored on update. */
  createdAt?: string | null;
  /** ISO-8601 or null — drives the last-write-wins merge decision. */
  updatedAt?: string | null;
}

export interface ParsedImport {
  collections: ParsedCollection[];
  bookmarks: ParsedBookmark[];
  skipped: ImportNote[];
  errors: ImportNote[];
}

export function emptyParsedImport(): ParsedImport {
  return { collections: [], bookmarks: [], skipped: [], errors: [] };
}

/** Merges `b` into `a` (used by the ZIP importer across archive members). */
export function mergeParsedImport(a: ParsedImport, b: ParsedImport): ParsedImport {
  a.collections.push(...b.collections);
  a.bookmarks.push(...b.bookmarks);
  a.skipped.push(...b.skipped);
  a.errors.push(...b.errors);
  return a;
}
