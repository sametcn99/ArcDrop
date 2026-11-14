import { describe, expect, it } from 'bun:test';
import { SyncConnections } from './sync-connections';

/** Trivial stand-in for a `ws` WebSocket — only identity matters here. */
const socket = (label: string) => ({ label });

describe('SyncConnections', () => {
  it('fans out strictly per user — the cross-user isolation invariant', () => {
    const registry = new SyncConnections<{ label: string }>();
    const aliceA = socket('alice-a');
    const aliceB = socket('alice-b');
    const bobA = socket('bob-a');
    registry.add('alice', aliceA);
    registry.add('alice', aliceB);
    registry.add('bob', bobA);

    expect(registry.connectionsOf('alice').map((c) => c.label)).toEqual(['alice-a', 'alice-b']);
    expect(registry.connectionsOf('bob').map((c) => c.label)).toEqual(['bob-a']);
    expect(registry.connectionsOf('nobody')).toEqual([]);
    expect(registry.has('alice')).toBeTrue();
    expect(registry.has('carol')).toBeFalse();
  });

  it('add is idempotent and remove cleans up empty users', () => {
    const registry = new SyncConnections<{ label: string }>();
    const a = socket('a');
    registry.add('u', a);
    registry.add('u', a);
    expect(registry.count()).toBe(1);

    registry.remove('u', socket('other')); // foreign client — no-op
    expect(registry.count()).toBe(1);
    registry.remove('u', a);
    expect(registry.count()).toBe(0);
    expect(registry.has('u')).toBeFalse();
    registry.remove('u', a); // removing again is a no-op
  });

  it('all() and clear() cover every user', () => {
    const registry = new SyncConnections<{ label: string }>();
    registry.add('u1', socket('1'));
    registry.add('u2', socket('2'));
    registry.add('u2', socket('3'));
    expect(registry.count()).toBe(3);
    expect(
      registry
        .all()
        .map((c) => c.label)
        .sort(),
    ).toEqual(['1', '2', '3']);

    registry.clear();
    expect(registry.count()).toBe(0);
  });
});
