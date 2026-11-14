/**
 * The `resyncRequired` decision for `GET /sync/changes` (plan D4).
 *
 * A client's cursor `since` means "I hold every event with seq <= since".
 * The server retains a window `minSeq..currentSeq` of the user's change
 * events (retention compaction deletes the older ones). The client can
 * converge from the delta alone iff every event it is missing is still
 * retained:
 *
 * - `since + 1 < minSeq` — the client is missing events (seq `since+1` …
 *   `minSeq-1`) that compaction already deleted → it MUST resync.
 * - `since > currentSeq` — a cursor the counter never issued (restored
 *   client state, a different instance) → resync, defensively.
 * - `minSeq === null && since < currentSeq` — compaction removed EVERY
 *   retained event, so any lag means missed (purged) events → resync.
 * - `minSeq === null && since === currentSeq` — the client is at the tip
 *   and nothing is retained; it needs nothing → no resync.
 *
 * Gapless per-user seqs (the `users.sync_seq` row lock) are what make the
 * first rule exact: the first event a lagging client needs is exactly
 * `since + 1`, so the comparison needs no knowledge of which seqs existed.
 */
export interface ResyncInput {
  /** The client's cursor (as a bigint). */
  since: bigint;
  /** Smallest retained seq for the user, or `null` when none are retained. */
  minSeq: bigint | null;
  /** The user's current seq counter (`users.sync_seq`). */
  currentSeq: bigint;
}

/** PostgreSQL `bigint` ceiling — cursors beyond it are nonsensical. */
export const MAX_SYNC_SEQ = 9_223_372_036_854_775_807n;

export function needsResync({ since, minSeq, currentSeq }: ResyncInput): boolean {
  if (since > currentSeq) return true;
  if (minSeq === null) return since < currentSeq;
  return since + 1n < minSeq;
}
