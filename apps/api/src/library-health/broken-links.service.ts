import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { ChangeLogService } from '@api/change-log/change-log.service';
import { MetadataFetchError, SsrfSafeFetchService } from '@api/metadata/ssrf-fetch.service';
import type { BrokenLinkCheckMode } from '@api/settings/settings.dto';
import { SettingsService } from '@api/settings/settings.service';
import type { Repository } from 'typeorm';

/** Maximum concurrent outbound probes during a sweep (M12 ticket: ≤5). */
export const MAX_BROKEN_LINKS_CONCURRENCY = 5;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_JITTER_MIN_MS = 50;
const DEFAULT_JITTER_MAX_MS = 250;

/**
 * Reasons that reflect SSRF / URL-policy refusals rather than a dead target.
 * These NEVER connect and NEVER flag the bookmark as broken.
 */
const POLICY_REFUSAL_REASONS = new Set([
  'private-address-blocked',
  'scheme-refused',
  'invalid-url',
  'unclassifiable-address',
]);

export interface SweepOptions {
  /** Overrides concurrency (clamped to `1..5`). */
  concurrency?: number;
  /** Minimum jitter delay (ms) between checks per worker; 0 in tests. */
  jitterMinMs?: number;
  /** Maximum jitter delay (ms) between checks per worker; 0 in tests. */
  jitterMaxMs?: number;
  /** Probe timeout override (ms). */
  deadlineMs?: number;
  /** Keyset page size. */
  batchSize?: number;
}

export interface SweepSummary {
  mode: BrokenLinkCheckMode;
  checked: number;
  markedBroken: number;
  cleared: number;
  skipped: number;
}

export type ProbeClassification =
  | { kind: 'healthy' }
  | { kind: 'broken'; reason: string }
  | { kind: 'ignore' }
  | { kind: 'policy-skip' };

/**
 * Pure detection-mode classifier (Raindrop parity G11 / M12):
 * - `basic`: HTTP 404 / 410 only.
 * - `default`: 404 / 410 + DNS resolution failure.
 * - `strict`: 404 / 410 + DNS failure + 5xx + timeout / redirect-loop / network error.
 * - `off`: never called.
 *
 * SSRF / scheme / invalid-url refusals always return `policy-skip`.
 * 2xx–3xx responses always return `healthy` (auto-clearing any prior flag).
 * Non-404/410 4xx responses (e.g. 401/403/429 bot gates) return `ignore`.
 */
export function classifyProbeOutcome(
  outcome: { ok: true; status: number } | { ok: false; reason: string },
  mode: Exclude<BrokenLinkCheckMode, 'off'>,
): ProbeClassification {
  if (outcome.ok) {
    const { status } = outcome;
    if (status === 404 || status === 410) {
      return { kind: 'broken', reason: `http-${status}` };
    }
    if (status >= 500 && status <= 599) {
      return mode === 'strict' ? { kind: 'broken', reason: `http-${status}` } : { kind: 'ignore' };
    }
    if (status >= 200 && status < 400) {
      return { kind: 'healthy' };
    }
    return { kind: 'ignore' };
  }

  const { reason } = outcome;
  if (POLICY_REFUSAL_REASONS.has(reason)) {
    return { kind: 'policy-skip' };
  }
  if (reason === 'dns-resolution-failed') {
    return mode === 'default' || mode === 'strict'
      ? { kind: 'broken', reason }
      : { kind: 'ignore' };
  }
  if (
    reason === 'timeout' ||
    reason === 'too-many-redirects' ||
    reason === 'redirect-without-location' ||
    reason === 'network-error'
  ) {
    return mode === 'strict' ? { kind: 'broken', reason } : { kind: 'ignore' };
  }
  return { kind: 'ignore' };
}

/**
 * Broken-links sweep engine (plan M12 / D19, parity G11, extended M18).
 *
 * Reuses M6's `SsrfSafeFetchService.probeUrl` so every check resolves DNS
 * first, blocks private IP ranges, and re-validates every redirect hop.
 * Sweeps active URL bookmarks (`storageKind = 'url'`) gently (≤5 concurrent,
 * jittered) — skipping file-backed bookmarks completely — and records
 * `bookmark:update` change events whenever `brokenAt` / `brokenReason` changes.
 */
@Injectable()
export class BrokenLinksService {
  private running = false;

  constructor(
    @InjectRepository(Bookmark) private readonly bookmarks: Repository<Bookmark>,
    private readonly settings: SettingsService,
    private readonly fetcher: SsrfSafeFetchService,
    private readonly changeLog: ChangeLogService,
  ) {}

  async sweep(opts: SweepOptions = {}): Promise<SweepSummary> {
    const mode = await this.settings.get('brokenLinkCheckMode');
    if (mode === 'off') {
      return { mode, checked: 0, markedBroken: 0, cleared: 0, skipped: 0 };
    }
    if (this.running) {
      return { mode, checked: 0, markedBroken: 0, cleared: 0, skipped: 0 };
    }

    this.running = true;
    try {
      const concurrency = Math.max(
        1,
        Math.min(opts.concurrency ?? MAX_BROKEN_LINKS_CONCURRENCY, MAX_BROKEN_LINKS_CONCURRENCY),
      );
      const jitterMinMs = Math.max(0, opts.jitterMinMs ?? DEFAULT_JITTER_MIN_MS);
      const jitterMaxMs = Math.max(jitterMinMs, opts.jitterMaxMs ?? DEFAULT_JITTER_MAX_MS);
      const batchSize = Math.max(1, opts.batchSize ?? DEFAULT_BATCH_SIZE);

      let checked = 0;
      let markedBroken = 0;
      let cleared = 0;
      let skipped = 0;
      let lastId: string | null = null;

      for (;;) {
        const qb = this.bookmarks
          .createQueryBuilder('b')
          .select(['b.id', 'b.userId', 'b.url', 'b.brokenAt', 'b.brokenReason'])
          .where('b.deletedAt IS NULL')
          .andWhere("b.storageKind = 'url'")
          .andWhere('b.url IS NOT NULL')
          .orderBy('b.id', 'ASC')
          .take(batchSize);

        if (lastId !== null) {
          qb.andWhere('b.id > :lastId', { lastId });
        }

        const batch = await qb.getMany();
        if (batch.length === 0) break;
        lastId = batch[batch.length - 1]!.id;

        let cursor = 0;
        const workerCount = Math.min(concurrency, batch.length);
        const workers = Array.from({ length: workerCount }, async () => {
          for (;;) {
            const idx = cursor++;
            if (idx >= batch.length) break;
            const row = batch[idx]!;
            const res = await this.checkBookmark(row, mode, opts.deadlineMs);
            if (res === 'policy-skip') {
              skipped++;
            } else {
              checked++;
              if (res === 'marked-broken') markedBroken++;
              else if (res === 'cleared') cleared++;
            }

            if (jitterMaxMs > 0) {
              const delay =
                jitterMinMs + Math.floor(Math.random() * (jitterMaxMs - jitterMinMs + 1));
              if (delay > 0) await sleep(delay);
            }
          }
        });
        await Promise.all(workers);

        if (batch.length < batchSize) break;
      }

      return { mode, checked, markedBroken, cleared, skipped };
    } finally {
      this.running = false;
    }
  }

  private async checkBookmark(
    row: Pick<Bookmark, 'id' | 'userId' | 'url' | 'brokenAt' | 'brokenReason'>,
    mode: Exclude<BrokenLinkCheckMode, 'off'>,
    deadlineMs?: number,
  ): Promise<'marked-broken' | 'cleared' | 'unchanged' | 'policy-skip'> {
    if (row.url === null) {
      return 'policy-skip';
    }
    const targetUrl = row.url;

    let outcome: { ok: true; status: number } | { ok: false; reason: string };
    try {
      const probe = await this.fetcher.probeUrl(targetUrl, { deadlineMs });
      outcome = { ok: true, status: probe.status };
    } catch (error) {
      const reason = error instanceof MetadataFetchError ? error.reason : 'network-error';
      outcome = { ok: false, reason };
    }

    const classification = classifyProbeOutcome(outcome, mode);
    if (classification.kind === 'policy-skip') {
      return 'policy-skip';
    }

    const now = new Date();
    const wasBroken = row.brokenAt !== null;

    if (classification.kind === 'broken') {
      const reasonChanged = !wasBroken || row.brokenReason !== classification.reason;
      if (reasonChanged) {
        const nextBrokenAt = row.brokenAt ?? now;
        await this.persistStatusChange(row.userId, row.id, targetUrl, {
          lastCheckedAt: now,
          brokenAt: nextBrokenAt,
          brokenReason: classification.reason,
        });
        return wasBroken ? 'unchanged' : 'marked-broken';
      }
      await this.touchLastCheckedAt(row.id, targetUrl, now);
      return 'unchanged';
    }

    if (classification.kind === 'healthy' && wasBroken) {
      await this.persistStatusChange(row.userId, row.id, targetUrl, {
        lastCheckedAt: now,
        brokenAt: null,
        brokenReason: null,
      });
      return 'cleared';
    }

    await this.touchLastCheckedAt(row.id, targetUrl, now);
    return 'unchanged';
  }

  private async persistStatusChange(
    userId: string,
    bookmarkId: string,
    expectedUrl: string,
    patch: { lastCheckedAt: Date; brokenAt: Date | null; brokenReason: string | null },
  ): Promise<void> {
    await this.changeLog.transact(async (manager, record) => {
      const fresh = await manager.findOne(Bookmark, {
        where: { id: bookmarkId, userId },
      });
      // Guard against concurrent trash or URL replacement while probe was in flight.
      if (!fresh || fresh.deletedAt !== null || fresh.url !== expectedUrl) {
        return;
      }
      await manager.update(Bookmark, { id: bookmarkId }, patch);
      await record(userId, { entity: 'bookmark', entityId: bookmarkId, action: 'update' });
    });
  }

  private async touchLastCheckedAt(
    bookmarkId: string,
    expectedUrl: string,
    now: Date,
  ): Promise<void> {
    await this.bookmarks
      .createQueryBuilder()
      .update(Bookmark)
      .set({ lastCheckedAt: now })
      .where('id = :id AND url = :url AND deleted_at IS NULL', {
        id: bookmarkId,
        url: expectedUrl,
      })
      .execute();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
