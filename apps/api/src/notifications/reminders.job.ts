import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RemindersService } from './reminders.service';

/**
 * Per-minute due-reminder sweep (plan M14 / D20). Guarded against overlapping
 * in-process ticks via `running` and against multi-worker/double-run races
 * via `FOR UPDATE OF b SKIP LOCKED` inside `RemindersService`.
 */
@Injectable()
export class RemindersJob {
  private readonly logger = new Logger(RemindersJob.name);
  private running = false;

  constructor(private readonly reminders: RemindersService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'due-reminders-sweep' })
  async handle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const summary = await this.reminders.processDueReminders();
      if (summary.fired > 0) {
        this.logger.log(`Due reminders sweep: fired=${summary.fired}`);
      }
    } catch (error) {
      this.logger.error(
        `Due reminders sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
