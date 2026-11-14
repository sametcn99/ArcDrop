import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IconEvictionService } from './icon-eviction.service';

/**
 * Daily icon-orphans sweep (ticket M6). Runs at 05:00 server time —
 * staggered behind the trash purge (03:00) and the change-log retention
 * (04:00) like the other maintenance jobs, and one hour behind the purge
 * specifically so icons orphaned BY that purge are swept on the same
 * night. Failures are logged, never raised — the next sweep retries.
 */
@Injectable()
export class IconEvictionJob {
  private readonly logger = new Logger(IconEvictionJob.name);

  constructor(private readonly eviction: IconEvictionService) {}

  @Cron('0 5 * * *', { name: 'icon-eviction' })
  async handle(): Promise<void> {
    try {
      const summary = await this.eviction.evictOrphaned();
      if (summary.evicted > 0) {
        this.logger.log(`Icon eviction removed ${summary.evicted} orphaned file(s)`);
      }
    } catch (error) {
      this.logger.error(
        `Icon eviction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
