import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';
import type { ContentType, StorageKind } from '@api/database/entities/bookmark.entity';
import { Collection } from '@api/database/entities/collection.entity';
import { queryRows } from '@api/database/query-rows';
import { BookmarksService } from '@api/bookmarks/bookmarks.service';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { FileStorageService } from '@api/files/file-storage.service';
import { sanitizeFileName } from '@api/files/file-types';
import type { DataSource } from 'typeorm';
import type { ExportBookmark, ExportCollection } from './export/export-document';
import {
  csvRowOf,
  htmlTreeOf,
  renderNetscapeDocument,
  ARCDROP_EXPORT_FORMAT,
} from './export/export-document';
import {
  renderHighlightsCsv,
  renderHighlightsTxt,
  type ExportHighlight,
} from './export/export-highlights';
import { createZipBuffer, type ZipWriteEntry } from './export/zip-writer';
import { emptyParsedImport, type ParsedImport } from './import/import-model';
import {
  detectJsonDialect,
  formatFromFilename,
  parsePayload,
  type ImportFormat,
} from './import/detect-format';
import { parseArcDropDocument } from './import/parse-arcdrop';
import { parseRaindropDocument } from './import/parse-raindrop';
import { parseZipImport } from './import/parse-zip';
import { ImportUpsertService } from './import/import-upsert.service';
import { ImportSummaryDto } from './portability.dto';

/** Keyset page size while streaming bookmarks out of the database. */
const EXPORT_BATCH = 500;

export const ARCDROP_BUNDLE_FORMAT = 'arcdrop/export-bundle/v1';

export interface ExportScope {
  collectionId: string;
  collectionPath: string[];
  /** The collection's active subtree (the root included) — membership filter. */
  subtreeIds: string[];
}

export interface ImportUpload {
  bytes: Buffer;
  /** Original filename — the REST route detects the format from it. */
  filename: string;
}

export interface HighlightsDownload {
  body: string;
  contentType: string;
  filename: string;
}

export interface ExportBundleManifestFile {
  bookmarkId: string;
  title: string | null;
  fileName: string;
  fileMime: string;
  fileSize: number;
  archivePath: string;
  sha256: string;
}

export interface ExportBundleManifest {
  format: typeof ARCDROP_BUNDLE_FORMAT;
  exportedAt: string;
  exportFormat: 'json' | 'csv' | 'html' | 'txt';
  scope: { collectionId: string; collectionPath: string[] } | null;
  fileCount: number;
  files: ExportBundleManifestFile[];
}

/**
 * Portability (plan M8, M10, M18): data in and out, user-scoped.
 *
 * - Export streams in batches (keyset pagination on bookmark id) for
 *   json/csv/txt; HTML buffers the rows it needs for the folder tree
 *   (personal-scale libraries — documented in the README). When
 *   `includeFiles=true`, produces a ZIP bundle containing `export.<format>`,
 *   `manifest.json`, and every active uploaded file (`files/<bookmarkId>-<name>`).
 *   Every export covers the ACTIVE library only (the trash auto-purges per D17
 *   and is not portable data), and identities travel as tag NAMES + collection
 *   PATHS so another instance can re-link them.
 * - Import acquires the per-user lock (ONE concurrent import; a second is
 *   a 409), parses with pure functions (per-item reasons), and upserts
 *   through the normal domain services (see `ImportUpsertService`).
 */
@Injectable()
export class PortabilityService {
  /** One concurrent import per user — in-memory, single-instance posture. */
  private readonly importLocks = new Set<string>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly bookmarksService: BookmarksService,
    private readonly upsert: ImportUpsertService,
    private readonly fileStorage: FileStorageService,
  ) {}

  // -- export -----------------------------------------------------------------

  /**
   * Resolves the export scope. Unknown or TRASHED scope collections are
   * 404s (the trash is not exported). Must run BEFORE the stream starts so
   * the 404 is still a problem+json response, not a broken download.
   */
  async resolveScope(
    userId: string,
    collectionId: string | undefined,
  ): Promise<ExportScope | null> {
    if (collectionId === undefined) return null;
    const root = await this.dataSource.manager.findOne(Collection, {
      where: { id: collectionId, userId, deletedAt: IsNull() },
    });
    if (root === null) throw new NotFoundException('Collection not found');

    // Active-only subtree (the same walk M4's cascade uses), root included.
    const subtreeIds: string[] = [root.id];
    let frontier: string[] = [root.id];
    const visited = new Set<string>(subtreeIds);
    while (frontier.length > 0) {
      const children = await queryRows(
        this.dataSource.manager,
        `SELECT id FROM collections
          WHERE user_id = $1 AND parent_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [userId, frontier],
      );
      frontier = children
        .map((row) => String(row.id))
        .filter((id) => {
          if (visited.has(id)) return false;
          visited.add(id);
          return true;
        });
      subtreeIds.push(...frontier);
    }

    return {
      collectionId: root.id,
      collectionPath: await this.rawTitlePath(userId, root.id),
      subtreeIds,
    };
  }

  /** Root→leaf title path of one collection, walking the RAW parent chain. */
  private async rawTitlePath(userId: string, collectionId: string): Promise<string[]> {
    const path: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null = collectionId;
    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const row: Collection | null = await this.dataSource.manager.findOne(Collection, {
        where: { id: currentId, userId },
        select: { id: true, parentId: true, title: true },
      });
      if (row === null) break; // dangling chain — impossible via the FK
      const title = row.title.trim();
      if (title.length > 0) path.unshift(title);
      currentId = row.parentId;
    }
    return path;
  }

  /**
   * The export stream: yields string chunks of the response body, bookmark
   * data batch-by-batch (keyset pagination). The controller starts the
   * download only after `resolveScope` has validated the scope.
   */
  async *exportChunks(
    user: RequestUser,
    format: 'json' | 'csv' | 'html' | 'txt',
    scope: ExportScope | null,
    exportedAt: string = new Date().toISOString(),
    archivePathByBookmarkId?: ReadonlyMap<string, string>,
  ): AsyncGenerator<string> {
    const { entries: collections, pathsById } = await this.exportCollections(user.id, scope);
    const tagNames = await this.exportTagNames(user.id, scope);

    if (format === 'json') {
      yield this.jsonPrelude(exportedAt, scope, collections, tagNames);
      let first = true;
      for await (const batch of this.exportBookmarkBatches(user, scope)) {
        for (const entry of batch) {
          const bookmark = this.toExportBookmark(entry, pathsById, archivePathByBookmarkId);
          yield (first ? '' : ',') + JSON.stringify(bookmark);
          first = false;
        }
      }
      yield ']}\n';
      return;
    }

    if (format === 'csv') {
      yield 'url,title,excerpt,note,tags,collections,createdAt,updatedAt\r\n';
      for await (const batch of this.exportBookmarkBatches(user, scope)) {
        for (const entry of batch) {
          yield csvRowOf(this.toExportBookmark(entry, pathsById, archivePathByBookmarkId)) + '\r\n';
        }
      }
      return;
    }

    if (format === 'txt') {
      for await (const batch of this.exportBookmarkBatches(user, scope)) {
        for (const entry of batch) {
          if (entry.row['url'] !== null) {
            yield `${String(entry.row['url'])}\n`;
          }
        }
      }
      return;
    }

    // html — needs the whole bookmark set to build the folder tree; the
    // rows are buffered (personal-scale — documented in the README).
    const all: ExportBookmark[] = [];
    for await (const batch of this.exportBookmarkBatches(user, scope)) {
      for (const entry of batch) {
        all.push(this.toExportBookmark(entry, pathsById, archivePathByBookmarkId));
      }
    }
    yield* renderNetscapeDocument(htmlTreeOf(collections, all));
  }

  /** Non-streaming variant — the MCP `exportData` tool (whole document). */
  async exportDocument(
    user: RequestUser,
    format: 'json' | 'csv' | 'html' | 'txt',
    collectionId: string | undefined,
  ): Promise<{ exportedAt: string; body: string }> {
    const scope = await this.resolveScope(user.id, collectionId);
    const exportedAt = new Date().toISOString();
    let body = '';
    for await (const chunk of this.exportChunks(user, format, scope, exportedAt)) body += chunk;
    return { exportedAt, body };
  }

  /**
   * Builds a ZIP bundle (M18 / D19, Raindrop parity G17) containing:
   * - `export.<format>`: the standard export document (with `file.archivePath`
   *   populated on file bookmarks in JSON exports),
   * - `manifest.json`: structured manifest with bookmark id, filename, MIME,
   *   size, `archivePath`, and SHA-256 digest per file,
   * - `files/<bookmarkId>-<sanitizedFileName>`: exact original uploaded bytes.
   */
  async exportZipBundle(
    user: RequestUser,
    format: 'json' | 'csv' | 'html' | 'txt',
    collectionId: string | undefined,
    preResolvedScope?: ExportScope | null,
  ): Promise<{ exportedAt: string; zipBuffer: Buffer; manifest: ExportBundleManifest }> {
    const scope =
      preResolvedScope !== undefined
        ? preResolvedScope
        : await this.resolveScope(user.id, collectionId);
    const exportedAt = new Date().toISOString();
    const modifiedAt = new Date(exportedAt);

    const fileEntries: ZipWriteEntry[] = [];
    const manifestFiles: ExportBundleManifestFile[] = [];
    const archivePathByBookmarkId = new Map<string, string>();

    for await (const batch of this.exportBookmarkBatches(user, scope)) {
      for (const entry of batch) {
        const row = entry.row;
        if (row['storage_kind'] !== 'file' || row['file_ref'] === null) continue;

        const bookmarkId = String(row['id']);
        const fileRef = String(row['file_ref']);
        const fileName = sanitizeFileName(
          row['file_name'] === null ? fileRef : String(row['file_name']),
        );
        const fileMime =
          row['file_mime'] === null ? 'application/octet-stream' : String(row['file_mime']);
        const fileSize = Number(row['file_size'] ?? 0);

        const bytes = await this.fileStorage.readBuffer(fileRef);
        if (bytes === null) continue;

        const archivePath = `files/${bookmarkId}-${fileName}`;
        const sha256 = createHash('sha256').update(bytes).digest('hex');

        archivePathByBookmarkId.set(bookmarkId, archivePath);
        fileEntries.push({ name: archivePath, bytes, modifiedAt });
        manifestFiles.push({
          bookmarkId,
          title: row['title'] === null ? null : String(row['title']),
          fileName,
          fileMime,
          fileSize,
          archivePath,
          sha256,
        });
      }
    }

    let documentBody = '';
    for await (const chunk of this.exportChunks(
      user,
      format,
      scope,
      exportedAt,
      archivePathByBookmarkId,
    )) {
      documentBody += chunk;
    }

    const manifest: ExportBundleManifest = {
      format: ARCDROP_BUNDLE_FORMAT,
      exportedAt,
      exportFormat: format,
      scope:
        scope === null
          ? null
          : { collectionId: scope.collectionId, collectionPath: scope.collectionPath },
      fileCount: manifestFiles.length,
      files: manifestFiles,
    };

    const zipBuffer = createZipBuffer([
      { name: `export.${format}`, bytes: Buffer.from(documentBody, 'utf8'), modifiedAt },
      {
        name: 'manifest.json',
        bytes: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
        modifiedAt,
      },
      ...fileEntries,
    ]);

    return { exportedAt, zipBuffer, manifest };
  }

  /**
   * All collections of the scope as path-addressed entries, plus the
   * id→path map the bookmark converter needs. Paths walk the RAW parent
   * chain (trashed ancestors contribute their title segment — an export
   * does not preserve trash per D17, so a re-import recreates the chain
   * active; documented).
   */
  private async exportCollections(
    userId: string,
    scope: ExportScope | null,
  ): Promise<{ entries: ExportCollection[]; pathsById: Map<string, string[]> }> {
    // ALL rows load (trash state included) — active children of a trashed
    // ancestor need the ancestor's title for a faithful path.
    const rows = await queryRows(
      this.dataSource.manager,
      `SELECT id, parent_id, title, icon, color, "order", deleted_at
         FROM collections
        WHERE user_id = $1
        ORDER BY created_at ASC, id ASC`,
      [userId],
    );
    const titles = new Map<string, string>();
    const parents = new Map<string, string | null>();
    const active = new Set<string>();
    const metaById = new Map<
      string,
      { icon: string | null; color: string | null; order: number }
    >();
    for (const row of rows) {
      const id = String(row['id']);
      titles.set(id, String(row['title']));
      parents.set(id, row['parent_id'] === null ? null : String(row['parent_id']));
      metaById.set(id, {
        icon: row['icon'] === null ? null : String(row['icon']),
        color: row['color'] === null ? null : String(row['color']),
        order: Number(row['order'] ?? 0),
      });
      if (row['deleted_at'] !== null) continue;
      active.add(id);
    }

    // Path per id via a children index walked from the roots (defensive
    // visited set — raw cycles are impossible through the API).
    const childrenByParent = new Map<string | null, string[]>();
    for (const [id, parentId] of parents) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(id);
      childrenByParent.set(parentId, list);
    }
    const pathsById = new Map<string, string[]>();
    const walk = (parentId: string | null, prefix: string[], depthGuard: number): void => {
      if (depthGuard > 10_000) return; // pathological data — stop, never loop
      for (const id of childrenByParent.get(parentId) ?? []) {
        const path = [...prefix, titles.get(id) ?? ''];
        pathsById.set(id, path);
        walk(id, path, depthGuard + 1);
      }
    };
    walk(null, [], 0);
    // Active children whose chain is broken by a trashed ancestor: walk
    // them as (temporary) roots so they never disappear from an export.
    for (const [id] of parents) {
      if (pathsById.has(id)) continue;
      walk(id, [], 0);
    }

    const inScope =
      scope === null
        ? (id: string) => active.has(id)
        : (id: string) => active.has(id) && scope.subtreeIds.includes(id);
    const entries: ExportCollection[] = [];
    for (const [id, meta] of metaById) {
      const path = pathsById.get(id);
      if (path === undefined || !inScope(id)) continue;
      entries.push({ path: path.filter((segment) => segment.length > 0), ...meta });
    }
    return { entries, pathsById };
  }

  /** Distinct tag names across the exported bookmarks (the JSON meta section). */
  private async exportTagNames(userId: string, scope: ExportScope | null): Promise<string[]> {
    const scopeFilter =
      scope === null
        ? ''
        : 'AND EXISTS (SELECT 1 FROM bookmark_collections bc WHERE bc.bookmark_id = b.id AND bc.collection_id = ANY($2::uuid[]))';
    const params: unknown[] = scope === null ? [userId] : [userId, scope.subtreeIds];
    const rows = await queryRows(
      this.dataSource.manager,
      `SELECT DISTINCT t.name
         FROM tags t
         JOIN bookmark_tags bt ON bt.tag_id = t.id
         JOIN bookmarks b ON b.id = bt.bookmark_id
        WHERE b.user_id = $1 AND b.deleted_at IS NULL ${scopeFilter}
        ORDER BY t.name ASC`,
      params,
    );
    return rows.map((row) => String(row['name']));
  }

  /**
   * Keyset-paginated bookmark batches (id ASC) over the ACTIVE scope, each
   * row bundled with its tag names, (scope-filtered) collection ids, and
   * highlight rows.
   */
  private async *exportBookmarkBatches(
    user: RequestUser,
    scope: ExportScope | null,
  ): AsyncGenerator<
    Array<{
      row: Record<string, unknown>;
      tags: Array<{ name: string }>;
      collectionIds: string[];
      highlights: ExportHighlight[];
    }>
  > {
    let lastId: string | null = null;
    for (;;) {
      // Placeholders are positional: $1 = userId, then (optionally) the
      // cursor, then (when scoped) the subtree ids.
      const params: unknown[] = [user.id];
      let cursorFilter = '';
      let scopeFilter = '';
      if (lastId !== null) {
        params.push(lastId);
        cursorFilter = `AND b.id > $${params.length}::uuid`;
      }
      if (scope !== null) {
        params.push(scope.subtreeIds);
        scopeFilter = `AND EXISTS (
          SELECT 1 FROM bookmark_collections bc
           WHERE bc.bookmark_id = b.id AND bc.collection_id = ANY($${params.length}::uuid[]))`;
      }

      const rows = await queryRows(
        this.dataSource.manager,
        `SELECT b.* FROM bookmarks b
          WHERE b.user_id = $1 AND b.deleted_at IS NULL ${cursorFilter} ${scopeFilter}
          ORDER BY b.id ASC
          LIMIT ${EXPORT_BATCH}`,
        params,
      );
      if (rows.length === 0) return;
      lastId = String(rows[rows.length - 1]!['id']);

      const ids = rows.map((row) => String(row['id']));
      const tags = await this.bookmarksService.tagsForBookmarks(ids);
      const memberships = await queryRows(
        this.dataSource.manager,
        `SELECT bc.bookmark_id AS "bookmarkId", bc.collection_id AS "collectionId"
           FROM bookmark_collections bc
          WHERE bc.bookmark_id = ANY($1::uuid[])`,
        [ids],
      );
      const byBookmark = new Map<string, string[]>();
      for (const membership of memberships) {
        const bookmarkId = String(membership['bookmarkId']);
        const collectionId = String(membership['collectionId']);
        if (scope !== null && !scope.subtreeIds.includes(collectionId)) continue;
        const list = byBookmark.get(bookmarkId) ?? [];
        list.push(collectionId);
        byBookmark.set(bookmarkId, list);
      }

      const highlightRows = await queryRows(
        this.dataSource.manager,
        `SELECT bookmark_id AS "bookmarkId", text, note, color, created_at
           FROM highlights
          WHERE user_id = $1 AND bookmark_id = ANY($2::uuid[])
          ORDER BY created_at ASC, id ASC`,
        [user.id, ids],
      );
      const highlightsByBookmark = new Map<string, ExportHighlight[]>();
      for (const hr of highlightRows) {
        const bookmarkId = String(hr['bookmarkId']);
        const list = highlightsByBookmark.get(bookmarkId) ?? [];
        list.push({
          text: String(hr['text']),
          note: hr['note'] === null ? null : String(hr['note']),
          color: hr['color'] === null ? null : String(hr['color']),
          createdAt: asIso(hr['created_at']),
        });
        highlightsByBookmark.set(bookmarkId, list);
      }

      yield rows.map((row) => ({
        row,
        tags: tags.get(String(row['id'])) ?? [],
        collectionIds: byBookmark.get(String(row['id'])) ?? [],
        highlights: highlightsByBookmark.get(String(row['id'])) ?? [],
      }));
    }
  }

  /** DB row + resolved tags/memberships/highlights → the wire-shape export bookmark. */
  private toExportBookmark(
    entry: {
      row: Record<string, unknown>;
      tags: Array<{ name: string }>;
      collectionIds: string[];
      highlights: ExportHighlight[];
    },
    pathsById: ReadonlyMap<string, string[]>,
    archivePathByBookmarkId?: ReadonlyMap<string, string>,
  ): ExportBookmark {
    const row = entry.row;
    const bookmarkId = String(row['id']);
    const storageKind: StorageKind = row['storage_kind'] === 'file' ? 'file' : 'url';
    const paths = entry.collectionIds
      .map((id) => pathsById.get(id))
      .filter((path): path is string[] => path !== undefined)
      .sort((a, b) => a.join('\u0000').localeCompare(b.join('\u0000')));

    const archivePath = archivePathByBookmarkId?.get(bookmarkId);
    const fileMeta =
      storageKind === 'file' && row['file_ref'] !== null
        ? {
            ref: String(row['file_ref']),
            name: String(row['file_name'] ?? row['file_ref']),
            mime: String(row['file_mime'] ?? 'application/octet-stream'),
            size: Number(row['file_size'] ?? 0),
            ...(archivePath !== undefined ? { archivePath } : {}),
          }
        : undefined;

    return {
      ...(storageKind === 'file' ? { storageKind, file: fileMeta } : {}),
      url: row['url'] === null ? null : String(row['url']),
      title: row['title'] === null ? null : String(row['title']),
      excerpt: row['excerpt'] === null ? null : String(row['excerpt']),
      note: row['note'] === null ? null : String(row['note']),
      favorite: Boolean(row['favorite']),
      contentType: String(row['content_type']) as ContentType,
      createdAt: asIso(row['created_at']),
      updatedAt: asIso(row['updated_at']),
      tags: entry.tags.map((tag) => tag.name).sort((a, b) => a.localeCompare(b)),
      collections: paths,
      highlights: entry.highlights,
    };
  }

  private jsonPrelude(
    exportedAt: string,
    scope: ExportScope | null,
    collections: ExportCollection[],
    tagNames: string[],
  ): string {
    const meta = {
      format: ARCDROP_EXPORT_FORMAT,
      exportedAt,
      scope:
        scope === null
          ? null
          : { collectionId: scope.collectionId, collectionPath: scope.collectionPath },
    };
    return (
      JSON.stringify(meta).slice(0, -1) +
      `,"collections":${JSON.stringify(collections)}` +
      `,"tags":${JSON.stringify(tagNames)}` +
      ',"bookmarks":['
    );
  }

  // -- per-bookmark highlights export (G4) ------------------------------------

  /**
   * The highlights download for one bookmark (owned; trash state included —
   * GET semantics mirror `GET /bookmarks/{id}`).
   */
  async exportBookmarkHighlights(
    user: RequestUser,
    bookmarkId: string,
    format: 'txt' | 'csv',
  ): Promise<HighlightsDownload> {
    const rows = await queryRows(
      this.dataSource.manager,
      `SELECT id FROM bookmarks WHERE user_id = $1 AND id = $2::uuid`,
      [user.id, bookmarkId],
    );
    if (rows.length === 0) throw new NotFoundException('Bookmark not found');

    const highlightRows = await queryRows(
      this.dataSource.manager,
      `SELECT text, note, color, created_at
         FROM highlights
        WHERE user_id = $1 AND bookmark_id = $2::uuid
        ORDER BY created_at ASC, id ASC`,
      [user.id, bookmarkId],
    );
    const highlights: ExportHighlight[] = highlightRows.map((row) => ({
      text: String(row['text']),
      note: row['note'] === null ? null : String(row['note']),
      color: row['color'] === null ? null : String(row['color']),
      createdAt: asIso(row['created_at']),
    }));

    if (format === 'txt') {
      return {
        body: renderHighlightsTxt(highlights),
        contentType: 'text/plain; charset=utf-8',
        filename: 'highlights.txt',
      };
    }
    return {
      body: renderHighlightsCsv(highlights),
      contentType: 'text/csv; charset=utf-8',
      filename: 'highlights.csv',
    };
  }

  // -- import -----------------------------------------------------------------

  /**
   * The per-user import lock. Returns the RELEASER, or `null` when the
   * user already has an import running (the caller turns that into a 409).
   */
  acquireImportLock(userId: string): (() => void) | null {
    if (this.importLocks.has(userId)) return null;
    this.importLocks.add(userId);
    return () => {
      this.importLocks.delete(userId);
    };
  }

  /** REST entry: multipart upload → filename detection → parse → upsert. */
  async importUpload(user: RequestUser, upload: ImportUpload): Promise<ImportSummaryDto> {
    const format = formatFromFilename(upload.filename);
    if (format === null) {
      throw new BadRequestException(
        `unsupported import file type: "${upload.filename}" — expected .json .csv .html .htm .txt .enex or .zip`,
      );
    }
    return this.runImport(user, format, upload.bytes);
  }

  /** MCP entry: explicit format + payload (the size cap lives in the DTO). */
  async importData(
    user: RequestUser,
    format: ImportFormat,
    bytes: Buffer,
  ): Promise<ImportSummaryDto> {
    return this.runImport(user, format, bytes);
  }

  private async runImport(
    user: RequestUser,
    format: ImportFormat,
    bytes: Buffer,
  ): Promise<ImportSummaryDto> {
    const release = this.acquireImportLock(user.id);
    if (release === null) {
      throw new ConflictException('An import is already running for this user');
    }
    try {
      const parsed = this.parseBytes(format, bytes);
      return await this.upsert.importParsed(user, parsed);
    } finally {
      release();
    }
  }

  /** Dispatches to the parser (zip members fan out, JSON sniffs dialects). */
  private parseBytes(format: ImportFormat, bytes: Buffer): ParsedImport {
    if (format === 'zip') return parseZipImport(bytes);
    const text = bytes.toString('utf8');
    if (format === 'json') {
      const dialect = detectJsonDialect(text);
      if (dialect === null) {
        const failed = emptyParsedImport();
        failed.errors.push({
          reason: 'unrecognized JSON dialect — expected an ArcDrop or Raindrop export',
        });
        return failed;
      }
      const value: unknown = JSON.parse(text);
      return dialect === 'raindrop' ? parseRaindropDocument(value) : parseArcDropDocument(value);
    }
    return parsePayload(format, text);
  }
}

// -- small helpers -----------------------------------------------------------

const asIso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
