import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Bookmark, type ContentType } from '@api/database/entities/bookmark.entity';
import { ChangeLogService } from '@api/change-log/change-log.service';
import type { Repository } from 'typeorm';
import { AppConfigService } from '@api/config/app-config.service';
import { classifyContentType } from './content-type';
import { parsePageMetadata } from './html-metadata';
import { IconCacheService } from './icon-cache.service';
import { HTML_CONTENT_TYPES, MetadataFetchError, SsrfSafeFetchService } from './ssrf-fetch.service';

/**
 * How the pipeline treats the server-owned icon refs:
 * - `fill` (create, backfill): everything is fill-if-null — fields a client
 *   provided are NEVER touched, and pre-existing refs are kept.
 * - `refresh` (url change, reindex): `coverRef`/`iconRef` are SERVER-owned
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

/** Security/policy failures that must abort enrichment completely without fallback. */
const HARD_REFUSAL_REASONS = new Set([
  'invalid-url',
  'scheme-refused',
  'private-address-blocked',
  'unclassifiable-address',
  'response-too-large',
]);

const clamp = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

/**
 * The async metadata pipeline (plan M6, extended M10): on bookmark create /
 * url update a background task fetches the target (SSRF-hardened — see
 * `SsrfSafeFetchService`), classifies `contentType` (response Content-Type →
 * `og:type` → URL extension → host pattern → `link`), extracts title /
 * description / og:image / favicon for HTML pages, caches cover+icon in the
 * icon cache and fills ONLY the fields that are still null. The create/update
 * response NEVER waits for this — scheduling is fire-and-forget and every
 * failure is swallowed (the bookmark keeps its client data).
 *
 * Completion writes through `ChangeLogService.transact` (its OWN
 * transaction, per the README contract): the row update and one
 * `bookmark:update` ChangeEvent commit together, and the M5 bus fans the
 * event out to connected devices only after the commit.
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
  ) {}

  /**
   * Fire-and-forget scheduling. Called AFTER the caller's transaction has
   * committed (so the row is visible to the pipeline's own reads) and never
   * blocks or rejects — `enrich` handles its own errors.
   */
  scheduleEnrichment(userId: string, bookmarkId: string, url: string, mode: EnrichmentMode): void {
    if (!this.config.metadataEnabled) return;
    void this.enrich(userId, bookmarkId, url, mode).catch(() => {}); // belt and braces — enrich already swallows
  }

  /**
   * `POST /bookmarks/{id}/reindex` — validates ownership + active state
   * (404 otherwise, same trash rules as PUT) and schedules a `refresh` run.
   * Returns immediately; the response says "scheduled", not "done".
   */
  async reindex(userId: string, bookmarkId: string): Promise<{ id: string; status: 'scheduled' }> {
    const row = await this.bookmarks.findOneBy({ id: bookmarkId, userId });
    if (!row) throw new NotFoundException('Bookmark not found');
    if (row.deletedAt) {
      // The trash is read-only except for restore.
      throw new NotFoundException('Bookmark not found among the active bookmarks');
    }
    this.scheduleEnrichment(userId, row.id, row.url, 'refresh');
    return { id: row.id, status: 'scheduled' };
  }

  /**
   * One pipeline run. Public so the reindex/backfill surfaces and the e2e
   * suite can await it deterministically; NEVER throws (outcome instead).
   */
  async enrich(
    userId: string,
    bookmarkId: string,
    url: string,
    mode: EnrichmentMode,
  ): Promise<EnrichmentOutcome> {
    if (!this.config.metadataEnabled) return 'skipped';

    let coverRef: string | null = null;
    let iconRef: string | null = null;
    let title: string | null = null;
    let description: string | null = null;
    let classified: ContentType = 'link';

    try {
      // -- 1. the resource (SSRF-guarded, HTML streams ≤2 MB, non-HTML cancels body) --
      const document = await this.fetcher.fetchResource(url);
      let ogType: string | null = null;

      if (HTML_CONTENT_TYPES.has(document.contentType)) {
        const parsed = parsePageMetadata(decodeUtf8(document.bytes), document.finalUrl);
        title = parsed.title;
        description = parsed.description;
        ogType = parsed.ogType;

        // -- 2. the cover (og:image) — guarded like everything else; a bad
        //      og:image never sinks the rest of the run ---------------------
        if (parsed.ogImage) {
          try {
            const image = await this.fetcher.fetchImage(parsed.ogImage);
            coverRef = await this.icons.store(image.bytes, image.contentType);
          } catch (error) {
            this.debugFailure('cover fetch', bookmarkId, error);
          }
        }

        // -- 3. the icon — explicit link first, then the conventional
        //      /favicon.ico fallback ---------------------------------------
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

      classified = classifyContentType({
        url: document.finalUrl,
        responseContentType: document.contentType,
        ogType,
      });
    } catch (error) {
      // Page fetch failed (SSRF refusal, timeout, DNS/network failure, …).
      // SSRF/policy/oversized refusals always abort silently. Network/HTTP/DNS
      // errors can still classify by URL extension / host patterns (e.g.
      // youtube.com in an offline environment); unclassified URLs yield 'link'
      // and return 'failed' below without touching the row.
      this.debugFailure('page fetch', bookmarkId, error);
      if (error instanceof MetadataFetchError && HARD_REFUSAL_REASONS.has(error.reason)) {
        return 'failed';
      }
      const fallbackType = classifyContentType({ url });
      if (fallbackType === 'link') return 'failed';
      classified = fallbackType;
    }

    // -- 4. completion write: one transaction, one bookmark:update event --
    return this.changeLog.transact(async (manager, record) => {
      const row = await manager.findOne(Bookmark, { where: { id: bookmarkId, userId } });
      if (!row) return 'skipped'; // purged/deleted while we were fetching
      if (row.deletedAt) return 'skipped'; // the trash is read-only except for restore

      const patch: Partial<Bookmark> = {};
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
        // refresh: replace server-owned refs & classification on success (the
        // old icon files orphan and the eviction job sweeps them).
        if (coverRef && coverRef !== row.coverRef) patch.coverRef = coverRef;
        if (iconRef && iconRef !== row.iconRef) patch.iconRef = iconRef;
        if (classified !== row.contentType) patch.contentType = classified;
      }

      if (Object.keys(patch).length === 0) return 'noop';
      await manager.update(Bookmark, { id: bookmarkId }, patch); // bumps updatedAt
      await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
      return 'updated';
    });
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
