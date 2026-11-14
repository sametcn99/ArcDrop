import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppConfigService } from '@api/config/app-config.service';
import { MetadataFetchService } from './metadata-fetch.service';

/**
 * Periodic retry sweep for failed archive fetches (plan M17 / D19).
 *
 * Runs every 5 minutes (only when `metadataEnabled` is true) and retries
 * active bookmarks whose `cache_status = 'failed'` and `cache_next_retry_at <= NOW()`
 * using exponential backoff. Failures are logged, never raised.
 */
@Injectable()
export class ArchiveRetryJob {
  private readonly logger = new Logger(ArchiveRetryJob.name);

  constructor(
    private readonly metadata: MetadataFetchService,
    private readonly config: AppConfigService,
  ) {}

  @Cron('*/5 * * * *', { name: 'archive-retry' })
  async handle(): Promise<void> {
    if (!this.config.metadataEnabled) return;
    try {
      const summary = await this.metadata.retryDueArchives();
      if (summary.attempted > 0) {
        this.logger.log(
          `Archive retry attempted ${summary.attempted} bookmark(s): ` +
            `${summary.succeeded} succeeded, ${summary.failed} failed`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Archive retry failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
