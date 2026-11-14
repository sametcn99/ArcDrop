/**
 * The ArcDrop export model (plan M8, M10). Export is user-scoped and covers
 * the ACTIVE library only (trash excluded — it auto-purges per D17);
 * identities (bookmark/collection/tag/highlight ids) are NOT exported: ids
 * are meaningless across instances, so relationships travel as tag NAMES and
 * collection PATHS and the importer re-links through them.
 */
import type { ContentType } from '@api/database/entities/bookmark.entity';
import type { ExportHighlight } from './export-highlights';

export const ARCDROP_EXPORT_FORMAT = 'arcdrop/v1';

export interface ExportCollection {
  /** Root→leaf title path (the importer's key). */
  path: string[];
  icon: string | null;
  color: string | null;
  order: number;
}

export interface ExportBookmark {
  url: string;
  title: string | null;
  excerpt: string | null;
  note: string | null;
  favorite?: boolean;
  contentType?: ContentType;
  createdAt: string;
  updatedAt: string;
  /** Tag names, case-preserving display spellings, sorted. */
  tags: string[];
  /** Each membership as a root→leaf title path. */
  collections: string[][];
  highlights: ExportHighlight[];
}

export interface ExportDocument {
  format: typeof ARCDROP_EXPORT_FORMAT;
  exportedAt: string;
  /** Present when the export was scoped to one collection subtree. */
  scope: { collectionId: string; collectionPath: string[] } | null;
  collections: ExportCollection[];
  /** Distinct tag names in the exported scope, sorted. */
  tags: string[];
  bookmarks: ExportBookmark[];
}

// -- CSV (lossy, documented) --------------------------------------------------

export const CSV_HEADER = [
  'url',
  'title',
  'excerpt',
  'note',
  'tags',
  'collections',
  'createdAt',
  'updatedAt',
] as const;

/** RFC 4180 quoting: wrap when needed, double the quotes inside. */
export function csvField(value: string): string {
  return /["\n\r,]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** CSV row: tags/collections join with `;`, path segments join with `/`. */
export function csvRowOf(bookmark: ExportBookmark): string {
  const cells = [
    bookmark.url,
    bookmark.title ?? '',
    bookmark.excerpt ?? '',
    bookmark.note ?? '',
    bookmark.tags.join(';'),
    bookmark.collections.map((path) => path.join('/')).join(';'),
    bookmark.createdAt,
    bookmark.updatedAt,
  ];
  return cells.map(csvField).join(',');
}

// -- Netscape HTML (lossy, documented) -----------------------------------------

const NETSCAPE_HEADER = [
  '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
  '<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->',
  '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
  '<TITLE>Bookmarks</TITLE>',
  '<H1>Bookmarks</H1>',
  '<DL><p>',
];

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const unixSeconds = (iso: string): string => String(Math.floor(Date.parse(iso) / 1000));

/** One `<DT><A …>` line with its optional `<DD>` description. */
function* renderNetscapeLink(bookmark: ExportBookmark, indent: string): Generator<string> {
  const attributes = [
    `HREF="${escapeHtml(bookmark.url)}"`,
    `ADD_DATE="${unixSeconds(bookmark.createdAt)}"`,
    bookmark.tags.length > 0 ? `TAGS="${escapeHtml(bookmark.tags.join(','))}"` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' ');
  const title = escapeHtml(bookmark.title ?? bookmark.url);
  yield `${indent}<DT><A ${attributes}>${title}</A>\n`;
  const description = bookmark.note ?? bookmark.excerpt;
  if (description !== null) yield `${indent}<DD>${escapeHtml(description)}\n`;
}

export interface HtmlFolder {
  /** Segment name for this folder. */
  title: string;
  order: number;
  createdAt?: string;
  children: HtmlFolder[];
  bookmarks: ExportBookmark[];
}

/**
 * Groups bookmarks into the folder tree by their FIRST collection path
 * (a bookmark with several memberships renders once — documented lossy);
 * bookmarks with no collection land at the root level.
 */
export function htmlTreeOf(
  collections: ExportCollection[],
  bookmarks: ExportBookmark[],
): HtmlFolder {
  const root: HtmlFolder = { title: '', order: 0, children: [], bookmarks: [] };
  const folderByPath = new Map<string, HtmlFolder>();
  const sortKey = (path: string[]): string => path.join('\n');

  for (const collection of [...collections].sort((a, b) =>
    sortKey(a.path).localeCompare(sortKey(b.path)),
  )) {
    let parent = root;
    for (let depth = 0; depth < collection.path.length; depth++) {
      const partial = collection.path.slice(0, depth + 1);
      const key = sortKey(partial);
      let folder = folderByPath.get(key);
      if (folder === undefined) {
        folder = {
          title: collection.path[depth]!,
          order: depth === collection.path.length - 1 ? collection.order : 0,
          children: [],
          bookmarks: [],
        };
        folderByPath.set(key, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
  }

  const assigned = new Set<string>();
  for (const bookmark of bookmarks) {
    const path = [...bookmark.collections].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))[0];
    if (path === undefined) continue;
    const folder = folderByPath.get(sortKey(path));
    if (folder === undefined) continue;
    folder.bookmarks.push(bookmark);
    assigned.add(bookmark.url);
  }
  root.bookmarks = bookmarks.filter((bookmark) => !assigned.has(bookmark.url));
  return root;
}

/**
 * Renders the Netscape document for a folder tree (collections as nested
 * `<H3>/<DL>` groups, unassigned bookmarks at the root level) — streamed.
 */
export function* renderNetscapeDocument(tree: HtmlFolder): Generator<string> {
  yield NETSCAPE_HEADER.join('\n') + '\n';
  yield* renderNetscapeFolder(tree, 1);
  yield '</DL><p>\n';
}

/**
 * Renders a folder tree as Netscape chunks — used by the service after
 * `htmlTreeOf`; bookmarks arrive inside their folders.
 */
export function* renderNetscapeFolder(folder: HtmlFolder, depth: number): Generator<string> {
  const indent = '    '.repeat(depth);
  for (const child of folder.children) {
    yield `${indent}<DT><H3>${escapeHtml(child.title)}</H3>\n`;
    yield `${indent}<DL><p>\n`;
    yield* renderNetscapeFolder(child, depth + 1);
    yield `${indent}</DL><p>\n`;
  }
  for (const bookmark of folder.bookmarks) {
    yield* renderNetscapeLink(bookmark, indent);
  }
}

// -- TXT -----------------------------------------------------------------------

/** One URL per line (Raindrop parity G3) — CRLF-free, trailing newline. */
export function* renderTxtChunks(bookmarks: Iterable<ExportBookmark>): Generator<string> {
  for (const bookmark of bookmarks) yield `${bookmark.url}\n`;
}
