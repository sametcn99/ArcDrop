import { Injectable } from '@nestjs/common';
import { TokenService } from '@api/auth/crypto/token.service';

/** Websocket tickets are single-use and live for one minute (ticket M5). */
export const SYNC_TICKET_TTL_MS = 60_000;

interface OutstandingTicket {
  userId: string;
  expiresAt: Date;
}

export interface IssuedSyncTicket {
  /** The value the client presents on the ws handshake. Never stored. */
  ticket: string;
  expiresAt: Date;
}

/**
 * One-time websocket tickets (plan D4, ticket M5): browsers cannot send an
 * `Authorization` header on the ws handshake, so the client first mints a
 * short-lived ticket over the authenticated REST surface
 * (`POST /sync/ticket`) and presents it as the `ticket` query parameter of
 * `GET /api/v1/sync/ws`. A ticket is:
 *
 * - **single use** — redeeming it atomically removes it (single-threaded
 *   JS: the check-and-delete is one synchronous step);
 * - **60-second TTL** — checked on redemption;
 * - **hashed at rest** — the map is keyed by sha256(ticket), mirroring the
 *   refresh-token discipline; a heap dump yields no usable ticket.
 *
 * The store is deliberately IN MEMORY (a Map): tickets are ephemeral by
 * construction (60s), a restart merely costs the client one reconnect +
 * re-mint, and no schema/migration is warranted for data that must not
 * outlive the process. Horizontal fan-out is out of scope for v1 (plan's
 * out-of-scope list), so process-local storage matches the deployment.
 */
@Injectable()
export class SyncTicketService {
  private readonly tickets = new Map<string, OutstandingTicket>();
  private readonly ttlMs = SYNC_TICKET_TTL_MS;

  constructor(private readonly tokens: TokenService) {}

  /** Mints a one-time ticket for `userId` and stores it (hashed). */
  issue(userId: string): IssuedSyncTicket {
    this.sweepExpired();
    const { raw, hash, expiresAt } = this.tokens.issue(this.ttlMs);
    this.tickets.set(hash, { userId, expiresAt });
    return { ticket: raw, expiresAt };
  }

  /**
   * Redeems a ticket presented on the handshake: returns the owning user id
   * once, `null` for unknown/expired/replayed tickets.
   */
  redeem(rawTicket: string | null): { userId: string } | null {
    if (!rawTicket) return null;
    const hash = this.tokens.hashRaw(rawTicket);
    const outstanding = this.tickets.get(hash);
    if (!outstanding) return null;
    this.tickets.delete(hash); // single use, even when already expired
    if (outstanding.expiresAt.getTime() <= Date.now()) return null;
    return { userId: outstanding.userId };
  }

  /**
   * Force-expires a ticket before its TTL — the revocation lever for tests
   * and future admin tooling. Setting its expiry into the past means
   * redemption refuses it through the EXACT same expiry check as a
   * naturally-aged ticket. Unknown tickets are a no-op.
   */
  expire(rawTicket: string): void {
    const outstanding = this.tickets.get(this.tokens.hashRaw(rawTicket));
    if (outstanding) outstanding.expiresAt = new Date(0);
  }

  /** Drops expired entries; O(size) over ≤60s-old tickets, so it stays cheap. */
  private sweepExpired(): void {
    const now = Date.now();
    for (const [hash, ticket] of this.tickets) {
      if (ticket.expiresAt.getTime() <= now) this.tickets.delete(hash);
    }
  }

  /** Outstanding count — tests and monitoring. */
  size(): number {
    return this.tickets.size;
  }
}
