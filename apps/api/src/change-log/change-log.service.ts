import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { ChangeEvent } from '@api/database/entities/change-event.entity';
import type {
  ChangeAction,
  ChangeEntity,
  ChangeEventNotification,
} from '@api/database/entities/change-event.entity';
import type { DataSource, EntityManager } from 'typeorm';
import { queryRows } from '@api/database/query-rows';
import { ChangeEventBus } from './change-event.bus';

/** What to record about one mutation. */
export interface RecordChangeInput {
  entity: ChangeEntity;
  entityId: string;
  action: ChangeAction;
}

/**
 * Records one change INSIDE the caller's transaction: takes the next
 * per-user seq (atomic increment) and appends the ChangeEvent row.
 */
export type ChangeRecorder = (userId: string, input: RecordChangeInput) => Promise<string>;

/**
 * The change-log writer (plan D4 — the milestone centerpiece). Every data
 * mutation in this and all later milestones goes through here:
 *
 * - The per-user seq comes from an atomic
 *   `UPDATE users SET sync_seq = sync_seq + 1 ... RETURNING` — the row lock
 *   the UPDATE takes serializes concurrent transactions on the same user, so
 *   seqs are strictly monotonic and GAPLESS (an increment that rolls back
 *   with its transaction leaves no hole).
 * - The ChangeEvent row is appended IN THE SAME TRANSACTION as the mutation
 *   itself — a mutation and its log entry commit together or not at all.
 * - Bus notifications (for M5's ws push) are published only AFTER the
 *   surrounding transaction commits — listeners never see rolled-back work.
 *
 * Transaction-throw discipline (M2 lesson, `AuthService.refresh`): `transact`
 * returns the work result and publishes events after `dataSource.transaction`
 * resolves; any throw inside `work` still aborts the whole transaction AND
 * suppresses the notifications.
 */
@Injectable()
export class ChangeLogService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly bus: ChangeEventBus,
  ) {}

  /**
   * Runs `work` inside one transaction, handing it a recorder bound to that
   * transaction. Every `record(userId, …)` call atomically takes the user's
   * next seq and appends the event; on commit, all recorded events are
   * published on the in-process bus in seq order.
   */
  async transact<T>(
    work: (manager: EntityManager, record: ChangeRecorder) => Promise<T>,
  ): Promise<T> {
    const recorded: ChangeEventNotification[] = [];

    const result = await this.dataSource.transaction(async (manager) => {
      const record: ChangeRecorder = async (userId, input) => {
        const seq = await this.record(manager, userId, input);
        recorded.push({
          userId,
          seq,
          entity: input.entity,
          entityId: input.entityId,
          action: input.action,
          occurredAt: new Date(),
        });
        return seq;
      };
      return work(manager, record);
    });

    for (const event of recorded) {
      this.bus.publish(event);
    }
    return result;
  }

  /**
   * Low-level append for callers that already own a transaction. Takes the
   * next seq for `userId` atomically and inserts the ChangeEvent row with it.
   * Returns the seq (decimal string — the column is bigint).
   */
  async record(manager: EntityManager, userId: string, input: RecordChangeInput): Promise<string> {
    // The UPDATE's row lock (held until COMMIT) serializes concurrent
    // writers per user — this is what makes the seq gapless.
    const rows = await queryRows(
      manager,
      'UPDATE users SET sync_seq = sync_seq + 1 WHERE id = $1 RETURNING sync_seq',
      [userId],
    );
    const seq = rows[0]?.sync_seq;
    if (seq === undefined) {
      // Unreachable while the FK exists (the mutating row references the
      // user) — but a missing user must not silently record seq "undefined".
      throw new NotFoundException(`Cannot record change: user ${userId} does not exist`);
    }

    const event = manager.create(ChangeEvent, {
      userId,
      seq: String(seq),
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
    });
    await manager.insert(ChangeEvent, event);
    return String(seq);
  }
}
