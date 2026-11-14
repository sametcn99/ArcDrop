import { Injectable, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { Setting } from '@api/database/entities/setting.entity';
import { queryRows } from '@api/database/query-rows';
import { DEFAULT_MONTHLY_UPLOAD_QUOTA_BYTES } from '@api/settings/settings.dto';

export interface MonthBucket {
  month: string;
  resetAt: string;
}

/**
 * Per-user monthly upload quota accounting (plan M18 / D19):
 * Tracks cumulative uploaded bytes per `(user_id, YYYY-MM)` UTC month bucket
 * in `upload_usage`. Quota breaches return RFC 7807 `413 Payload Too Large`
 * with `code: 'UPLOAD_QUOTA_EXCEEDED'`, `limitBytes`, `usedBytes`, and `resetAt`
 * (the exact UTC timestamp when the next month's bucket opens).
 */
@Injectable()
export class UploadQuotaService {
  currentMonthBucket(now: Date = new Date()): MonthBucket {
    const year = now.getUTCFullYear();
    const monthIndex = now.getUTCMonth(); // 0..11
    const month = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const resetAt = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0, 0)).toISOString();
    return { month, resetAt };
  }

  /**
   * Atomically checks `used + bytes <= monthlyUploadQuotaBytes` and increments
   * the user's current-month counter inside the caller's transaction. Callers
   * MUST hold the `users` row lock first (`record(...)`) to maintain strict lock order.
   */
  async consumeOrThrow(
    manager: EntityManager,
    userId: string,
    bytes: number,
    now: Date = new Date(),
  ): Promise<{ month: string; usedBytes: number; limitBytes: number; resetAt: string }> {
    const settingRow = await manager.findOneBy(Setting, { key: 'monthlyUploadQuotaBytes' });
    const limitBytes =
      typeof settingRow?.value === 'number' && Number.isFinite(settingRow.value)
        ? settingRow.value
        : DEFAULT_MONTHLY_UPLOAD_QUOTA_BYTES;

    const { month, resetAt } = this.currentMonthBucket(now);

    await manager.query(
      `INSERT INTO upload_usage (id, user_id, month, bytes_used)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id, month) DO NOTHING`,
      [randomUUID(), userId, month],
    );

    const rows = await queryRows(
      manager,
      `SELECT bytes_used AS "bytesUsed"
         FROM upload_usage
        WHERE user_id = $1 AND month = $2
        FOR UPDATE`,
      [userId, month],
    );

    const usedBytes = Number(rows[0]?.bytesUsed ?? 0);
    if (usedBytes + bytes > limitBytes) {
      throw new PayloadTooLargeException({
        code: 'UPLOAD_QUOTA_EXCEEDED',
        message:
          `Monthly upload quota exceeded (${usedBytes} + ${bytes} > ${limitBytes} bytes for ${month}). ` +
          `Quota resets on ${resetAt}; retry after that UTC rollover or wait for an admin quota increase.`,
        limitBytes,
        usedBytes,
        resetAt,
      });
    }

    const updated = usedBytes + bytes;
    await manager.query(
      `UPDATE upload_usage
          SET bytes_used = $3, updated_at = now()
        WHERE user_id = $1 AND month = $2`,
      [userId, month, updated],
    );

    return { month, usedBytes: updated, limitBytes, resetAt };
  }
}
