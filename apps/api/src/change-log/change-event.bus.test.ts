import { describe, expect, it, onTestFinished } from 'bun:test';
import { ChangeEventBus } from './change-event.bus';
import type { ChangeEventNotification } from '@api/database/entities/change-event.entity';

const event = (seq: string): ChangeEventNotification => ({
  userId: 'user-1',
  seq,
  entity: 'bookmark',
  entityId: 'bm-1',
  action: 'create',
  occurredAt: new Date(0),
});

describe('ChangeEventBus', () => {
  it('delivers events to every subscriber in order', () => {
    const bus = new ChangeEventBus();
    const a: ChangeEventNotification[] = [];
    const b: ChangeEventNotification[] = [];
    const offA = bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.publish(event('1'));
    bus.publish(event('2'));

    expect(a.map((e) => e.seq)).toEqual(['1', '2']);
    expect(b.map((e) => e.seq)).toEqual(['1', '2']);

    offA();
    bus.publish(event('3'));
    expect(a.map((e) => e.seq)).toEqual(['1', '2']); // unsubscribed
    expect(b.map((e) => e.seq)).toEqual(['1', '2', '3']);
  });

  it('isolates broken listeners — publish never throws', () => {
    const bus = new ChangeEventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('listener blew up');
    });
    bus.subscribe((e) => seen.push(e.seq));

    expect(() => bus.publish(event('7'))).not.toThrow();
    expect(seen).toEqual(['7']);
  });

  it('clears listeners on shutdown', () => {
    const bus = new ChangeEventBus();
    bus.subscribe(() => undefined);
    expect(bus.listenerCount()).toBe(1);
    bus.onApplicationShutdown();
    expect(bus.listenerCount()).toBe(0);

    onTestFinished(() => undefined);
  });
});
