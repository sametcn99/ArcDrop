import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Bookmark,
  type CacheStatus,
  type ContentType,
} from '@api/database/entities/bookmark.entity';
import { ChangeLogService } from '@api/change-log/change-log.service';
import { IsNull, LessThanOrEqual, Not, type Repository } from 'typeorm';
import { AppConfigService } from '@api/config/app-config.service';
import { SettingsService } from '@api/settings/settings.service';
import { ArchiveStorageService } from './archive-storage.service';
import {
  detectLoginOrPaywall,
  extractHtmlContent,
  extractPdfContent,
  extractPlainTextContent,
  PDF_CONTENT_TYPE,
  PLAIN_TEXT_CONTENT_TYPES,
  type ExtractedContent,
} from './content-extractor';
import { classifyContentType } from './content-type';
import { parsePageMetadata } from './html-metadata';
import { IconCacheService } from './icon-cache.service';
import {
  HTML_CONTENT_TYPES,
  MAX_RESPONSE_BYTES,
  MetadataFetchError,
  SsrfSafeFetchService,
} from './ssrf-fetch.service';

/**
 * How the pipeline treats the server-owned icon refs:
 * - `fill` (create, backfill): everything is fill-if-null — fields a client
 *   provided are NEVER touched, and pre-existing refs are kept.
 * - `refresh` (url change, reindex, retry): `coverRef`/`iconRef` are SERVER-owned
 *   cache references for THE URL'S page — after a url change they would
 *   point at the old site's images, so a successful fetch REPLACES them
 *   (the replaced files are orphaned and swept by the eviction job).
 *   Client-facing text (title/excerpt) stays fill-if-null in both modes —
 *   the pipeline cannot distinguish a client-provided title from one it
 *   fetched itself, and "never overwrite client-provided fields" (ticket)
 *   wins. `contentType` is server-derived: `fill` sets it when still `'link'`,
 *   `refresh` re-classifies it.
 */
export type EnrichmentMode = 'fill' | 'refresh';

export type EnrichmentOutcome = 'updated' | 'noop' | 'skipped' | 'failed';

/** DTO caps — fetched text is clamped so the row can never exceed the wire contract. */
const MAX_TITLE_LENGTH = 512;
const MAX_EXCERPT_LENGTH = 2000;

/** Exponential backoff schedule (30s → 2m → 10m → 1h → 6h), capped at 5 attempts. */
export const ARCHIVE_RETRY_BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;
export const MAX_ARCHIVE_RETRIES = ARCHIVE_RETRY_BACKOFF_MS.length;

/** SSRF/URL policy failures that abort silently without emitting bookmark:update. */
const SSRF_REFUSAL_REASONS = new Set([
  'invalid-url',
  'scheme-refused',
  'private-address-blocked',
  'unclassifiable-address',
]);

/** HTTP statuses indicating a login wall, paywall, or auth-gated origin. */
const INVALID_ORIGIN_HTTP_STATUSES = new Set([401, 402, 403, 407]);

const isArchivableContentType = (contentType: string): boolean =>
  HTML_CONTENT_TYPES.has(contentType) ||
  contentType === PDF_CONTENT_TYPE ||
  PLAIN_TEXT_CONTENT_TYPES.has(contentType);

const clamp = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

export function computeNextRetryAt(retryCount: number, now: Date = new Date()): Date | null {
  if (retryCount < 1 || retryCount > MAX_ARCHIVE_RETRIES) return null;
  const delayMs = ARCHIVE_RETRY_BACKOFF_MS[retryCount - 1]!;
  return new Date(now.getTime() + delayMs);
}

/**
 * The async metadata & permanent-copy archive pipeline (plan M6, extended M10
 * & M17): on bookmark create / url update / reindex a background task fetches the
 * target (SSRF-hardened — see `SsrfSafeFetchService`), classifies `contentType`,
 * extracts title / description / og:image / favicon for HTML pages, caches
 * cover+icon in the icon cache, and extracts readable HTML + plain text (for
 * HTML, PDF, and plain-text targets) under `ARCDROP__DATA_DIR/archives/{id}/`
 * plus a capped DB `archive_text` copy for Postgres FTS.
 *
 * Completion writes through `ChangeLogService.transact` (its OWN transaction):
 * the row update and one `bookmark:update` ChangeEvent commit together, and the
 * M5 bus fans the event out to connected devices only after commit.
 *
 * File-backed bookmarks (`storageKind = 'file'`) never enter this network
 * pipeline — they are extracted locally from disk on upload (M18).
 */
@Injectable()
export class MetadataFetchService {
  private readonly logger = new Logger(MetadataFetchService.name);

  constructor(
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly changeLog: ChangeLogService,
    private readonly icons: IconCacheService,
    private readonly fetcher: SsrfSafeFetchService,
    private readonly config: AppConfigService,
    private readonly archives: ArchiveStorageService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Fire-and-forget scheduling. Called AFTER the caller's transaction has
   * committed (so the row is visible to the pipeline's own reads) and never
   * blocks or rejects — `enrich` handles its own errors.
   */
  scheduleEnrichment(userId: string, bookmarkId: string, url: string, mode: EnrichmentMode): void {
    if (!this.config.metadataEnabled) return;
    void this.enrich(userId, bookmarkId, url, mode).catch(() => {});
  }

  /**
   * `POST /bookmarks/{id}/reindex` — validates ownership + active state
   * (404 otherwise, same trash rules as PUT), refuses file-backed bookmarks (400),
   * and schedules a `refresh` run that re-extracts metadata, icons, and the
   * permanent archive copy.
   */
  async reindex(userId: string, bookmarkId: string): Promise<{ id: string; status: 'scheduled' }> {
    const row = await this.bookmarks.findOneBy({ id: bookmarkId, userId });
    if (!row) throw new NotFoundException('Bookmark not found');
    if (row.deletedAt) {
      throw new NotFoundException('Bookmark not found among the active bookmarks');
    }
    if (row.storageKind === 'file' || row.url === null) {
      throw new BadRequestException(
        'File-backed bookmarks are indexed locally on upload and cannot be re-fetched from a URL',
      );
    }
    this.scheduleEnrichment(userId, row.id, row.url, 'refresh');
    return { id: row.id, status: 'scheduled' };
  }

  /**
   * Retries failed archive fetches whose exponential backoff deadline has
   * elapsed (`cache_status = 'failed' AND cache_next_retry_at <= now`).
   * Public so both `ArchiveRetryJob` and deterministic tests can invoke it.
   */
  async retryDueArchives(
    now: Date = new Date(),
    batchSize: number = 50,
  ): Promise<{ attempted: number; succeeded: number; failed: number }> {
    if (!this.config.metadataEnabled) return { attempted: 0, succeeded: 0, failed: 0 };

    const due = await this.bookmarks.find({
      where: {
        storageKind: 'url',
        url: Not(IsNull()),
        cacheStatus: 'failed',
        cacheNextRetryAt: LessThanOrEqual(now),
        deletedAt: IsNull(),
      },
      order: { cacheNextRetryAt: 'ASC', id: 'ASC' },
      take: batchSize,
      select: { id: true, userId: true, url: true },
    });

    let succeeded = 0;
    let failed = 0;
    for (const row of due) {
      if (!row.url) continue;
      const outcome = await this.enrich(row.userId, row.id, row.url, 'refresh');
      if (outcome === 'updated' || outcome === 'noop') {
        const refreshed = await this.bookmarks.findOne({
          where: { id: row.id },
          select: { id: true, cacheStatus: true },
        });
        if (refreshed?.cacheStatus === 'ready') {
          succeeded++;
          continue;
        }
      }
      failed++;
    }
    return { attempted: due.length, succeeded, failed };
  }

  /**
   * One pipeline run. Public so the reindex/backfill/retry surfaces and the
   * e2e suite can await it deterministically; NEVER throws (outcome instead).
   */
  async enrich(
    userId: string,
    bookmarkId: string,
    url: string,
    mode: EnrichmentMode,
  ): Promise<EnrichmentOutcome> {
    if (!this.config.metadataEnabled) return 'skipped';

    // Never fetch or archive trashed/missing/file-backed bookmarks.
    const initialRow = await this.bookmarks.findOne({
      where: { id: bookmarkId, userId },
      select: { id: true, storageKind: true, deletedAt: true, cacheRetryCount: true },
    });
    if (!initialRow || initialRow.deletedAt || initialRow.storageKind !== 'url') return 'skipped';

    const now = new Date();
    const archiveMaxBytes = await this.settings.get('archiveMaxBytes');

    let coverRef: string | null = null;
    let iconRef: string | null = null;
    let title: string | null = null;
    let description: string | null = null;
    let classified: ContentType = 'link';

    let extracted: ExtractedContent | null = null;
    let nextCacheStatus: CacheStatus = 'skipped';
    let nextCacheError: string | null = null;
    let shouldResetRetry = false;
    let isTransientFailure = false;

    try {
      const document = await this.fetcher.fetchArchiveResource(url, {
        maxBytes: archiveMaxBytes,
        readBodyWhen: isArchivableContentType,
      });
      let ogType: string | null = null;

      if (HTML_CONTENT_TYPES.has(document.contentType)) {
        const html = decodeUtf8(document.bytes);
        if (document.bytes.byteLength <= MAX_RESPONSE_BYTES) {
          const parsed = parsePageMetadata(html, document.finalUrl);
          title = parsed.title;
          description = parsed.description;
          ogType = parsed.ogType;

          if (parsed.ogImage) {
            try {
              const image = await this.fetcher.fetchImage(parsed.ogImage);
              coverRef = await this.icons.store(image.bytes, image.contentType);
            } catch (error) {
              this.debugFailure('cover fetch', bookmarkId, error);
            }
          }

          const iconUrl = parsed.favicon ?? this.conventionalFavicon(document.finalUrl);
          if (iconUrl) {
            try {
              const image = await this.fetcher.fetchImage(iconUrl);
              iconRef = await this.icons.store(image.bytes, image.contentType);
            } catch (error) {
              this.debugFailure('icon fetch', bookmarkId, error);
            }
          }
        }

        const candidate = extractHtmlContent(html, document.finalUrl);
        const wallReason = detectLoginOrPaywall(
          html,
          document.finalUrl,
          candidate?.textContent ?? '',
          url,
        );
        if (wallReason !== null) {
          nextCacheStatus = 'invalid-origin';
          nextCacheError = wallReason;
          shouldResetRetry = true;
        } else if (candidate !== null) {
          extracted = candidate;
          nextCacheStatus = 'ready';
          nextCacheError = null;
          shouldResetRetry = true;
        } else {
          nextCacheStatus = 'skipped';
          nextCacheError = 'empty-content';
          shouldResetRetry = true;
        }
      } else if (document.contentType === PDF_CONTENT_TYPE) {
        try {
          const candidate = await extractPdfContent(document.bytes);
          if (candidate !== null) {
            extracted = candidate;
            nextCacheStatus = 'ready';
            nextCacheError = null;
            shouldResetRetry = true;
          } else {
            nextCacheStatus = 'skipped';
            nextCacheError = 'empty-pdf-text';
            shouldResetRetry = true;
          }
        } catch (error) {
          this.debugFailure('pdf extraction', bookmarkId, error);
          nextCacheStatus = 'skipped';
          nextCacheError = 'pdf-extraction-failed';
          shouldResetRetry = true;
        }
      } else if (PLAIN_TEXT_CONTENT_TYPES.has(document.contentType)) {
        const candidate = extractPlainTextContent(decodeUtf8(document.bytes));
        if (candidate !== null) {
          extracted = candidate;
          nextCacheStatus = 'ready';
          nextCacheError = null;
          shouldResetRetry = true;
        } else {
          nextCacheStatus = 'skipped';
          nextCacheError = 'empty-content';
          shouldResetRetry = true;
        }
      } else {
        nextCacheStatus = 'skipped';
        nextCacheError = 'unsupported-content-type';
        shouldResetRetry = true;
      }

      classified = classifyContentType({
        url: document.finalUrl,
        responseContentType: document.contentType,
        ogType,
      });
    } catch (error) {
      this.debugFailure('page fetch', bookmarkId, error);

      if (error instanceof MetadataFetchError && SSRF_REFUSAL_REASONS.has(error.reason)) {
        // SSRF refusals MUST NOT emit a bookmark:update change event (M6 AC),
        // while keeping archive state honest (`skipped`) on the row.
        await this.bookmarks.update(
          { id: bookmarkId, userId, deletedAt: IsNull() },
          {
            cacheStatus: 'skipped',
            cacheCheckedAt: now,
            cacheError: error.reason,
            cacheNextRetryAt: null,
          },
        );
        return 'failed';
      }

      if (error instanceof MetadataFetchError && error.reason === 'response-too-large') {
        nextCacheStatus = 'skipped';
        nextCacheError = 'response-too-large';
        shouldResetRetry = true;
      } else if (
        error instanceof MetadataFetchError &&
        error.reason === 'http-status' &&
        error.httpStatus !== undefined &&
        INVALID_ORIGIN_HTTP_STATUSES.has(error.httpStatus)
      ) {
        nextCacheStatus = 'invalid-origin';
        nextCacheError = `http-${error.httpStatus}`;
        shouldResetRetry = true;
      } else {
        nextCacheStatus = 'failed';
        nextCacheError =
          error instanceof MetadataFetchError
            ? error.httpStatus !== undefined
              ? `http-${error.httpStatus}`
              : error.reason
            : 'fetch-error';
        isTransientFailure = true;
        const fallbackType = classifyContentType({ url });
        if (fallbackType !== 'link') classified = fallbackType;
      }
    }

    if (extracted !== null) {
      await this.archives.write(bookmarkId, {
        html: extracted.htmlContent,
        text: extracted.textContent,
      });
    }

    const outcome = await this.changeLog.transact(async (manager, record) => {
      const row = await manager.findOne(Bookmark, { where: { id: bookmarkId, userId } });
      if (!row || row.deletedAt || row.storageKind !== 'url') {
        return 'skipped' as const;
      }

      const patch: Partial<Bookmark> = {
        cacheStatus: nextCacheStatus,
        cacheCheckedAt: now,
        cacheError: nextCacheError,
      };

      if (extracted !== null) {
        patch.archiveText = extracted.dbTextContent;
      } else if (nextCacheStatus === 'invalid-origin' || nextCacheStatus === 'skipped') {
        patch.archiveText = null;
      }

      if (shouldResetRetry) {
        patch.cacheRetryCount = 0;
        patch.cacheNextRetryAt = null;
      } else if (isTransientFailure) {
        const nextCount = (row.cacheRetryCount ?? 0) + 1;
        patch.cacheRetryCount = nextCount;
        patch.cacheNextRetryAt = computeNextRetryAt(nextCount, now);
      }

      if (row.title === null && title) patch.title = clamp(title, MAX_TITLE_LENGTH);
      if (row.excerpt === null && description) {
        patch.excerpt = clamp(description, MAX_EXCERPT_LENGTH);
      }

      if (mode === 'fill') {
        if (row.coverRef === null && coverRef) patch.coverRef = coverRef;
        if (row.iconRef === null && iconRef) patch.iconRef = iconRef;
        if (row.contentType === 'link' && classified !== 'link') {
          patch.contentType = classified;
        }
      } else {
        if (coverRef && coverRef !== row.coverRef) patch.coverRef = coverRef;
        if (iconRef && iconRef !== row.iconRef) patch.iconRef = iconRef;
        if (classified !== row.contentType) patch.contentType = classified;
      }

      await manager.update(Bookmark, { id: bookmarkId }, patch);
      await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
      return isTransientFailure ? ('failed' as const) : ('updated' as const);
    });

    if (outcome === 'skipped' || (extracted === null && shouldResetRetry)) {
      void this.archives.remove(bookmarkId).catch(() => {});
    }

    return outcome;
  }

  /** `https://cdn.example/a/b` → `https://cdn.example/favicon.ico`. */
  private conventionalFavicon(pageUrl: string): string | null {
    try {
      return new URL('/favicon.ico', pageUrl).href;
    } catch {
      return null;
    }
  }

  private debugFailure(stage: string, bookmarkId: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.debug(`metadata ${stage} failed for bookmark ${bookmarkId}: ${reason}`);
  }
}
