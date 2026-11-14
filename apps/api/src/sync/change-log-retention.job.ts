import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ChangeLogRetentionService } from './change-log-retention.service';

/**
 * Daily change-log retention sweep (plan D4). Runs at 04:00 server time —
 * staggered one hour behind the trash purge (03:00) so the two heavy
 * retention jobs never compete. The window itself is runtime-configurable
 * via the instance settings (`changeLogRetentionDays`, default 90).
 * Failures are logged, never raised — the next sweep retries.
 */
@Injectable()
export class ChangeLogRetentionJob {
  private readonly logger = new Logger(ChangeLogRetentionJob.name);

  constructor(private readonly retention: ChangeLogRetentionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'change-log-retention' })
  async handle(): Promise<void> {
    try {
      const summary = await this.retention.purgeExpired();
      if (summary.purged > 0) {
        this.logger.log(`Change-log retention deleted ${summary.purged} event(s)`);
      }
    } catch (error) {
      this.logger.error(
        `Change-log retention failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
