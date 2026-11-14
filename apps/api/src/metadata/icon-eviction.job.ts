import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FileEvictionService } from '@api/files/file-eviction.service';
import { IconEvictionService } from './icon-eviction.service';

/**
 * Daily icon & uploaded-file orphans sweep (tickets M6 & M18). Runs at 05:00 server time —
 * staggered behind the trash purge (03:00) and the change-log retention
 * (04:00) like the other maintenance jobs, and one hour behind the purge
 * specifically so icons/files orphaned BY that purge are swept on the same
 * night. Failures are logged, never raised — the next sweep retries.
 */
@Injectable()
export class IconEvictionJob {
  private readonly logger = new Logger(IconEvictionJob.name);

  constructor(
    private readonly eviction: IconEvictionService,
    private readonly fileEviction: FileEvictionService,
  ) {}

  @Cron('0 5 * * *', { name: 'icon-eviction' })
  async handle(): Promise<void> {
    try {
      const iconSummary = await this.eviction.evictOrphaned();
      if (iconSummary.evicted > 0) {
        this.logger.log(`Icon eviction removed ${iconSummary.evicted} orphaned file(s)`);
      }
      const fileSummary = await this.fileEviction.evictOrphaned();
      if (fileSummary.evicted > 0) {
        this.logger.log(`File eviction removed ${fileSummary.evicted} orphaned upload(s)`);
      }
    } catch (error) {
      this.logger.error(
        `Orphan eviction failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
