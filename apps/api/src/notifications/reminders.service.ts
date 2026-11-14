import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ChangeLogService } from '@api/change-log/change-log.service';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { NotificationOutbox } from '@api/database/entities/notification-outbox.entity';
import { queryRows } from '@api/database/query-rows';
import { SyncGateway } from '@api/sync/sync.gateway';

const SWEEP_BATCH_SIZE = 200;

export interface ReminderSweepSummary {
  fired: number;
}

interface DueBookmarkRow {
  id: string;
  userId: string;
  title: string | null;
  url: string;
  reminderAt: Date;
}

/**
 * Due-reminder processor (plan M14 / D20):
 *
 * - Scans active (non-trashed), unfired reminders (`reminder_at <= now` AND
 *   `reminded_at IS NULL` AND `deleted_at IS NULL`) belonging to `active`
 *   users (`users.status = 'active'`).
 * - Locks selected bookmark rows with `FOR UPDATE OF b SKIP LOCKED` inside
 *   `ChangeLogService.transact`, sets `reminded_at`, inserts `NotificationOutbox`
 *   rows, and appends `bookmark:update` change events atomically.
 * - Strictly AFTER commit, pushes `{ type: 'reminder', bookmarkId, title }`
 *   to the owning user's websocket room (no SMTP, D20).
 * - Concurrent/double sweeps are safe: `SKIP LOCKED` + `reminded_at IS NULL`
 *   guarantee exactly-once firing.
 */
@Injectable()
export class RemindersService {
  constructor(
    private readonly changeLog: ChangeLogService,
    private readonly syncGateway: SyncGateway,
  ) {}

  async processDueReminders(now = new Date()): Promise<ReminderSweepSummary> {
    let totalFired = 0;

    while (true) {
      const firedBatch = await this.processBatch(now);
      if (firedBatch.length === 0) break;

      for (const item of firedBatch) {
        this.syncGateway.pushToUser(item.userId, {
          type: 'reminder',
          bookmarkId: item.bookmarkId,
          title: item.title,
        });
      }

      totalFired += firedBatch.length;
      if (firedBatch.length < SWEEP_BATCH_SIZE) break;
    }

    return { fired: totalFired };
  }

  private async processBatch(
    now: Date,
  ): Promise<Array<{ userId: string; bookmarkId: string; title: string | null }>> {
    return this.changeLog.transact(async (manager, record) => {
      const rows = await queryRows(
        manager,
        `SELECT b.id, b.user_id, b.title, b.url, b.reminder_at
           FROM bookmarks b
           INNER JOIN users u ON u.id = b.user_id
          WHERE b.reminder_at IS NOT NULL
            AND b.reminder_at <= $1
            AND b.reminded_at IS NULL
            AND b.deleted_at IS NULL
            AND u.status = 'active'
          ORDER BY b.user_id ASC, b.reminder_at ASC, b.id ASC
          LIMIT $2
          FOR UPDATE OF b SKIP LOCKED`,
        [now, SWEEP_BATCH_SIZE],
      );

      if (rows.length === 0) return [];

      const due: DueBookmarkRow[] = rows.map((row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        title: row.title === null || row.title === undefined ? null : String(row.title),
        url: String(row.url),
        reminderAt:
          row.reminder_at instanceof Date ? row.reminder_at : new Date(String(row.reminder_at)),
      }));

      const outboxEntries = due.map((item) =>
        manager.create(NotificationOutbox, {
          id: randomUUID(),
          userId: item.userId,
          type: 'reminder',
          bookmarkId: item.id,
          payload: {
            bookmarkId: item.id,
            title: item.title,
            url: item.url,
            reminderAt: item.reminderAt.toISOString(),
          },
          createdAt: now,
          readAt: null,
        }),
      );

      for (const item of due) {
        await manager.update(Bookmark, { id: item.id }, { remindedAt: now });
      }
      await manager.insert(NotificationOutbox, outboxEntries);

      for (const item of due) {
        await record(item.userId, { entity: 'bookmark', entityId: item.id, action: 'update' });
      }

      return due.map((item) => ({
        userId: item.userId,
        bookmarkId: item.id,
        title: item.title,
      }));
    });
  }
}
