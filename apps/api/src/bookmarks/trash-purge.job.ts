import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TrashPurgeService } from './trash-purge.service';

/**
 * Daily trash-retention sweep (plan D17). Runs at 03:00 server time; the
 * retention window itself is runtime-configurable via the instance settings
 * (`trashRetentionDays`, default 30). Failures are logged, never raised —
 * the next sweep retries.
 */
@Injectable()
export class TrashPurgeJob {
  private readonly logger = new Logger(TrashPurgeJob.name);

  constructor(private readonly purge: TrashPurgeService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'trash-purge' })
  async handle(): Promise<void> {
    try {
      const summary = await this.purge.purgeExpired();
      if (summary.purged > 0) {
        this.logger.log(`Trash purge hard-deleted ${summary.purged} expired bookmark(s)`);
      }
    } catch (error) {
      this.logger.error(
        `Trash purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
