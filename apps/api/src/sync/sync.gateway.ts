import type { IncomingMessage } from 'node:http';
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { ChangeEventNotification } from '@api/database/entities/change-event.entity';
import { ChangeEventBus } from '@api/change-log/change-event.bus';
import { WebSocket } from 'ws';
import { SyncConnections } from './sync-connections';
import { SyncTicketService } from './sync-ticket.service';

/**
 * The ws endpoint clients connect to. The HTTP surface carries the global
 * `api` prefix + URI versioning; websocket gateways do not pass through
 * either mechanism, so the full path is fixed here — `/api/v1/sync/ws`.
 */
export const SYNC_WS_PATH = '/api/v1/sync/ws';

/** Server pings idle connections every 30s; two missed pongs → terminate. */
export const SYNC_WS_HEARTBEAT_INTERVAL_MS = 30_000;

/** RFC 6455 close codes used on this endpoint. */
const CLOSE_POLICY_VIOLATION = 1008; // ticket missing/invalid/expired/replayed
const CLOSE_GOING_AWAY = 1001; // server shutdown

/**
 * Websocket push channel (plan D4, ticket M5; extended M14 for reminder
 * notifications). Adapter: RAW `ws` (via `@nestjs/platform-ws`), not
 * socket.io — see the README's M5 section for the trade-off record.
 *
 * Semantics:
 * - **Sync notifications.** Each committed change (the `ChangeEventBus`
 *   publishes strictly post-commit) is pushed as
 *   `{ seq, entity, id, action }` to the owning user's connections. The
 *   message carries NO snapshot — clients pull `/sync/changes?since=cursor`
 *   on every notification; the REST delta is the source of truth.
 * - **Reminder notifications (M14).** Due reminders push
 *   `{ type: 'reminder', bookmarkId, title }` post-commit via `pushToUser`
 *   to the owning user's active connections; offline devices read the durable
 *   `NotificationOutbox` via `GET /notifications`.
 * - **Rooms.** `ws` has no room concept; the per-user registry
 *   (`SyncConnections`) routes each event strictly to its owner's
 *   connections — cross-user isolation is structural.
 * - **Auth.** One-time ticket on the handshake query string
 *   (`?ticket=`; browsers cannot send headers on ws). Missing, unknown,
 *   expired or already-redeemed tickets are rejected with close code
 *   1008 before the connection ever joins a room.
 * - **Heartbeat.** Protocol-level: the server pings every 30s, pongs are
 *   answered automatically by browsers and `ws`-based clients (no client
 *   code), and a connection that misses two pongs is terminated.
 * - **Push-only.** Client messages are ignored — the adapter's handler
 *   map for this gateway is empty and unknown payloads are dropped.
 */
@WebSocketGateway({ path: SYNC_WS_PATH })
export class SyncGateway implements OnGatewayInit, OnApplicationShutdown {
  private readonly logger = new Logger(SyncGateway.name);
  private readonly connections = new SyncConnections<WebSocket>();
  /** Per-socket pong liveness for the heartbeat sweep. */
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private unsubscribeBus: (() => void) | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly tickets: SyncTicketService,
    private readonly bus: ChangeEventBus,
  ) {}

  afterInit(): void {
    // `ChangeLogService` publishes only AFTER its transaction commits, so
    // nothing here can observe rolled-back work.
    this.unsubscribeBus = this.bus.subscribe((event) => this.fanOut(event));
    this.heartbeatTimer = setInterval(() => this.heartbeat(), SYNC_WS_HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();
  }

  /**
   * Handshake auth: redeem the `?ticket=` query parameter and either join
   * the user's room or reject the connection before it exists for the
   * application. `close(1008, reason)` is the universal rejection —
   * browsers and every RFC 6455 client surface the code + reason.
   */
  handleConnection(client: WebSocket, request: IncomingMessage): void {
    const ticket = this.ticketFrom(request);
    if (!ticket) {
      client.close(CLOSE_POLICY_VIOLATION, 'sync ticket missing');
      return;
    }
    const redeemed = this.tickets.redeem(ticket);
    if (!redeemed) {
      client.close(CLOSE_POLICY_VIOLATION, 'sync ticket invalid, expired or already used');
      return;
    }

    this.connections.add(redeemed.userId, client);
    this.alive.set(client, true);
    client.on('pong', () => this.alive.set(client, true));
    client.on('close', () => {
      this.connections.remove(redeemed.userId, client);
    });
    client.on('error', () => {
      // Errors are logged by the adapter; terminate so `close` (and the
      // registry cleanup) follows promptly instead of hanging a dead pipe.
      try {
        client.terminate();
      } catch {
        // already unusable — the close event still arrives
      }
    });
  }

  onApplicationShutdown(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;
    for (const client of this.connections.all()) {
      try {
        client.close(CLOSE_GOING_AWAY, 'server shutting down');
      } catch {
        // best-effort; the adapter tears the server down anyway
      }
    }
    this.connections.clear();
  }

  /**
   * Pushes a JSON frame to every open ws connection in `userId`'s room.
   * Callers MUST invoke this strictly post-commit so clients never observe
   * rolled-back work.
   */
  pushToUser(userId: string, frame: Record<string, unknown>): void {
    const targets = this.connections.connectionsOf(userId);
    if (targets.length === 0) return;
    const payload = JSON.stringify(frame);
    for (const client of targets) {
      if (client.readyState !== WebSocket.OPEN) continue;
      try {
        client.send(payload);
      } catch {
        // Broken pipe mid-send: terminate; the close event cleans up.
        try {
          client.terminate();
        } catch {
          // socket already gone
        }
      }
    }
  }

  /** `{ seq, entity, id, action }` — seq as a decimal string (bigint-safe). */
  private fanOut(event: ChangeEventNotification): void {
    this.pushToUser(event.userId, {
      seq: event.seq,
      entity: event.entity,
      id: event.entityId,
      action: event.action,
    });
  }

  /** Two missed pongs → the peer is gone; terminate triggers the cleanup. */
  private heartbeat(): void {
    for (const client of this.connections.all()) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (this.alive.get(client) !== true) {
        this.logger.debug('sync ws connection missed its pong — terminating');
        try {
          client.terminate();
        } catch {
          // close event handles the registry
        }
        continue;
      }
      this.alive.set(client, false);
      try {
        client.ping();
      } catch {
        try {
          client.terminate();
        } catch {
          // socket already gone
        }
      }
    }
  }

  private ticketFrom(request: IncomingMessage): string | null {
    try {
      const url = new URL(request.url ?? '/', 'ws://arcdrop.invalid');
      const ticket = url.searchParams.get('ticket');
      return ticket && ticket.length > 0 ? ticket : null;
    } catch {
      return null;
    }
  }
}
