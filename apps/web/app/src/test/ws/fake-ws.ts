import type { WebSocketLike } from '../../api/sync-engine';

export class FakeWebSocket implements WebSocketLike {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly ticket: string | null;
  readyState: number = FakeWebSocket.CONNECTING;
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    try {
      const parsed = new URL(url, 'ws://localhost');
      this.ticket = parsed.searchParams.get('ticket');
    } catch {
      this.ticket = null;
    }
  }

  simulateOpen(): void {
    if (this.readyState !== FakeWebSocket.CONNECTING) return;
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  simulateMessage(payload: unknown): void {
    if (this.readyState !== FakeWebSocket.OPEN) return;
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.onmessage?.({ data });
  }

  simulateError(event: unknown = new Event('error')): void {
    this.onerror?.(event);
  }

  simulateClose(code = 1006, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }
}

export interface FakeWebSocketController {
  readonly instances: FakeWebSocket[];
  readonly latest: FakeWebSocket | undefined;
  readonly WebSocketCtor: new (url: string) => FakeWebSocket;
  setAutoOpen: (autoOpen: boolean) => void;
  reset: () => void;
  restore: () => void;
}

export function installFakeWebSocket(initialAutoOpen = true): FakeWebSocketController {
  const previousWebSocket = globalThis.WebSocket;
  const instances: FakeWebSocket[] = [];
  let autoOpen = initialAutoOpen;

  class ManagedFakeWebSocket extends FakeWebSocket {
    constructor(url: string) {
      super(url);
      instances.push(this);
      if (autoOpen) {
        queueMicrotask(() => {
          this.simulateOpen();
        });
      }
    }
  }

  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    writable: true,
    value: ManagedFakeWebSocket,
  });

  return {
    get instances() {
      return instances;
    },
    get latest() {
      return instances[instances.length - 1];
    },
    WebSocketCtor: ManagedFakeWebSocket,
    setAutoOpen(next: boolean) {
      autoOpen = next;
    },
    reset() {
      for (const ws of instances) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.readyState = FakeWebSocket.CLOSED;
      }
      instances.length = 0;
      autoOpen = initialAutoOpen;
    },
    restore() {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        writable: true,
        value: previousWebSocket,
      });
    },
  };
}
