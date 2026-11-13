import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { ChangeEventNotification } from '@api/database/entities/change-event.entity';

type ChangeListener = (event: ChangeEventNotification) => void;

/**
 * In-process fan-out for committed change events (plan D4 — "single instance
 * in v1 (in-process event bus fan-out)"). `ChangeLogService` publishes AFTER
 * its transaction commits, so listeners never see events for mutations that
 * rolled back.
 *
 * M5's websocket gateway subscribes here and pushes `{seq, entity, id,
 * action}` to the user's connected devices; until then nothing subscribes
 * and delivery is a no-op. Errors in a listener are isolated — a broken
 * subscriber must not take down the writer (or the request).
 */
@Injectable()
export class ChangeEventBus implements OnApplicationShutdown {
  private readonly listeners = new Set<ChangeListener>();

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ChangeEventNotification): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listeners are best-effort notifications; isolation beats surfacing.
      }
    }
  }

  /** Synchronous drain for tests. */
  listenerCount(): number {
    return this.listeners.size;
  }

  onApplicationShutdown(): void {
    this.listeners.clear();
  }
}
