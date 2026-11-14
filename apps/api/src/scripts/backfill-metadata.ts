import 'reflect-metadata';
import { AppConfigService } from '@api/config/app-config.service';
import { loadConfig } from '@api/config/load-config';
import { ChangeEventBus } from '@api/change-log/change-event.bus';
import { ChangeLogService } from '@api/change-log/change-log.service';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { Setting } from '@api/database/entities/setting.entity';
import { createDataSource } from '@api/database/data-source';
import { ArchiveStorageService } from '@api/metadata/archive-storage.service';
import { IconCacheService } from '@api/metadata/icon-cache.service';
import { MetadataFetchService, type EnrichmentOutcome } from '@api/metadata/metadata-fetch.service';
import { SsrfSafeFetchService } from '@api/metadata/ssrf-fetch.service';
import { SettingsService } from '@api/settings/settings.service';

/**
 * Metadata & archive backfill (ticket M6, extended M17/M18) — one-shot CLI for
 * active URL bookmarks created BEFORE M6/M17 (coverRef/iconRef/title/excerpt still null
 * or `cacheStatus = 'pending'`). Runs the SAME pipeline
 * (`MetadataFetchService.enrich`, `fill` mode: only null fields are filled,
 * SSRF rules fully enforced) over active bookmarks in stable id order.
 *
 * Run inside the container (the image ships this bundle):
 *
 *   docker compose exec api bun dist/scripts/backfill-metadata.js
 *   docker compose exec api bun dist/scripts/backfill-metadata.js --user=<uuid>
 *
 * Locally: `bun run backfill:metadata` in apps/api (builds first), or
 * `bun src/scripts/backfill-metadata.ts` with the usual env vars set.
 * Re-runnable by construction (fill-if-null — a second run is a no-op for
 * already-enriched rows). Idempotent, sequential, silent per-row failures.
 *
 * Exit codes: 0 = ran (any per-row outcome), 1 = bad env or metadata
 * pipeline disabled (nothing will ever happen — surface it loudly).
 */

const BATCH_SIZE = 100;

function parseArgs(argv: readonly string[]): { userId?: string } {
  let userId: string | undefined;
  for (const arg of argv) {
    const match = /^--user=([0-9a-fA-F-]{36})$/.exec(arg);
    if (match) userId = match[1]?.toLowerCase();
  }
  return { userId };
}

async function main(): Promise<void> {
  const { userId } = parseArgs(process.argv.slice(2));

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof Error && error.name === 'ConfigValidationError') {
      process.stderr.write(`✗ Invalid environment — ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  if (!config.metadata.enabled) {
    process.stderr.write(
      '✗ The metadata pipeline is disabled (ARCDROP__METADATA__ENABLED=false) — nothing to backfill.\n',
    );
    process.exit(1);
  }

  const configService = new AppConfigService(config);
  const dataSource = createDataSource(config);
  await dataSource.initialize();

  try {
    const bus = new ChangeEventBus();
    const changeLog = new ChangeLogService(dataSource, bus);
    const icons = new IconCacheService(config);
    const archives = new ArchiveStorageService(config);
    const settings = new SettingsService(dataSource.getRepository(Setting));
    const fetcher = new SsrfSafeFetchService(configService);
    const metadata = new MetadataFetchService(
      dataSource.getRepository(Bookmark),
      changeLog,
      icons,
      fetcher,
      configService,
      archives,
      settings,
    );

    const tally: Record<EnrichmentOutcome, number> = { updated: 0, noop: 0, skipped: 0, failed: 0 };
    // The id cursor starts BELOW every possible uuid (a "" would not cast).
    let cursorId = '00000000-0000-0000-0000-000000000000';
    let scanned = 0;

    for (;;) {
      let batch = dataSource
        .getRepository(Bookmark)
        .createQueryBuilder('b')
        .where('b.id > :cursorId', { cursorId })
        .andWhere('b.deletedAt IS NULL')
        .andWhere("b.storageKind = 'url'")
        .andWhere('b.url IS NOT NULL')
        .andWhere(
          "(b.coverRef IS NULL OR b.iconRef IS NULL OR b.title IS NULL OR b.excerpt IS NULL OR b.cacheStatus = 'pending')",
        );
      if (userId) batch = batch.andWhere('b.userId = :userId', { userId });
      const rows = await batch.orderBy('b.id', 'ASC').take(BATCH_SIZE).getMany();

      if (rows.length === 0) break;

      for (const row of rows) {
        cursorId = row.id;
        if (!row.url) continue;
        scanned++;
        const outcome = await metadata.enrich(row.userId, row.id, row.url, 'fill');
        tally[outcome]++;
        if (outcome === 'updated') {
          process.stdout.write(`✓ ${row.id} (${row.url})\n`);
        }
      }
    }

    process.stdout.write(
      `backfill done — scanned ${scanned} candidate(s), updated ${tally.updated}, ` +
        `noop ${tally.noop}, failed ${tally.failed}, skipped ${tally.skipped}\n`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`✗ backfill failed: ${(error as Error).message}\n`);
  process.exit(1);
});
