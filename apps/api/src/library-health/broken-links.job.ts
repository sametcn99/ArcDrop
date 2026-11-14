import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BrokenLinksService } from './broken-links.service';

/**
 * Daily broken-links sweep (plan M12 / D19, parity G11). Runs at 06:00 server
 * time — staggered behind trash purge (03:00), change-log retention (04:00),
 * and icon eviction (05:00). Failures are logged, never raised — the next
 * sweep retries.
 */
@Injectable()
export class BrokenLinksJob {
  private readonly logger = new Logger(BrokenLinksJob.name);

  constructor(private readonly brokenLinks: BrokenLinksService) {}

  @Cron('0 6 * * *', { name: 'broken-links-sweep' })
  async handle(): Promise<void> {
    try {
      const summary = await this.brokenLinks.sweep();
      if (summary.mode !== 'off' && (summary.markedBroken > 0 || summary.cleared > 0)) {
        this.logger.log(
          `Broken-links sweep (${summary.mode}): checked=${summary.checked}, markedBroken=${summary.markedBroken}, cleared=${summary.cleared}, skipped=${summary.skipped}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Broken-links sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
