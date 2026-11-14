import { describe, expect, it } from 'bun:test';
import { TokenService } from '@api/auth/crypto/token.service';
import { SyncTicketService } from './sync-ticket.service';

describe('SyncTicketService', () => {
  it('issues and redeems exactly once, for the right user', () => {
    const svc = new SyncTicketService(new TokenService());
    const { ticket } = svc.issue('user-1');

    const redeem = svc.redeem(ticket);
    expect(redeem).not.toBeNull();
    expect(redeem?.userId).toBe('user-1');

    // Second presentation — replay — is refused.
    expect(svc.redeem(ticket)).toBeNull();
    expect(svc.size()).toBe(0);
  });

  it('refuses null, unknown and tampered tickets', () => {
    const svc = new SyncTicketService(new TokenService());
    expect(svc.redeem(null)).toBeNull();
    expect(svc.redeem('never-issued')).toBeNull();

    const { ticket } = svc.issue('user-1');
    expect(svc.redeem(`${ticket}x`)).toBeNull();
    expect(svc.redeem(ticket)).not.toBeNull(); // the original still redeems
  });

  it('refuses expired tickets — the same expiry check a TTL-aged ticket hits', () => {
    const svc = new SyncTicketService(new TokenService());
    const { ticket } = svc.issue('user-1');
    svc.expire(ticket); // sets the stored expiry into the past
    expect(svc.redeem(ticket)).toBeNull();
  });

  it('expire() force-expires an outstanding ticket', () => {
    const svc = new SyncTicketService(new TokenService());
    const { ticket } = svc.issue('user-2');
    svc.expire(ticket);
    expect(svc.redeem(ticket)).toBeNull();
    svc.expire('unknown'); // no-op, no throw
  });

  it('tickets are scoped per user', () => {
    const svc = new SyncTicketService(new TokenService());
    const a = svc.issue('alice');
    const b = svc.issue('bob');
    expect(svc.redeem(a.ticket)?.userId).toBe('alice');
    expect(svc.redeem(b.ticket)?.userId).toBe('bob');
  });
  it('issued tickets look like 256-bit base64url tokens', () => {
    const svc = new SyncTicketService(new TokenService());
    const { ticket, expiresAt } = svc.issue('user-1');
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
