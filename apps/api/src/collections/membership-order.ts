import { queryRows } from '@api/database/query-rows';
import type { EntityManager } from 'typeorm';

/**
 * Takes the caller's `users` row lock (`FOR UPDATE`) inside an active
 * transaction without mutating `sync_seq`.
 *
 * All mutations that write `bookmark_collections` MUST hold the `users` row
 * lock BEFORE reading `MAX(order)` or touching `bookmark_collections` — either
 * via an earlier `ChangeLogService.record(userId, ...)` call or via this helper.
 * That preserves the global lock order (`users` -> `bookmarks`/`collections`
 * -> `bookmark_collections`) so concurrent writes never deadlock and parallel
 * membership appends into the same collection serialize cleanly (M4/M16).
 */
export async function lockUserForMembershipAppend(
  manager: EntityManager,
  userId: string,
): Promise<void> {
  await queryRows(manager, 'SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
}

/**
 * Next manual-order append position (`MAX(order) + 1`, or `0` when the
 * collection has no non-null ordered rows yet) across ALL memberships in
 * `collectionId` — including memberships whose bookmark is currently in the
 * trash, so restoring a trashed bookmark never collides with a slot assigned
 * while it was trashed.
 *
 * Callers MUST hold the user's `users` row lock inside the transaction before
 * invoking this helper.
 */
export async function nextMembershipOrder(
  manager: EntityManager,
  collectionId: string,
): Promise<number> {
  const rows = await queryRows(
    manager,
    `SELECT COALESCE(MAX("order"), -1) + 1 AS next
       FROM bookmark_collections
      WHERE collection_id = $1`,
    [collectionId],
  );
  return Number(rows[0]?.next ?? 0);
}
