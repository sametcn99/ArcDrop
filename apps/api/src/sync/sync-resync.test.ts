import { describe, expect, it } from 'bun:test';
import { MAX_SYNC_SEQ, needsResync } from './sync-resync';

/**
 * Boundary table for the resync decision: every rule of `needsResync`
 * (see the module doc) including the exact `since + 1 === minSeq`
 * continuation edge, which must NOT resync.
 */
describe('needsResync', () => {
  const n = (s: string) => BigInt(s);

  it('continues normally when the cursor sits exactly one below the retained window', () => {
    // Client holds 1..4, retained window starts at 5 — nothing is missing.
    expect(needsResync({ since: n('4'), minSeq: n('5'), currentSeq: n('10') })).toBeFalse();
  });

  it('flags a cursor that predates the retained window (the deep-offline case)', () => {
    expect(needsResync({ since: n('0'), minSeq: n('5'), currentSeq: n('10') })).toBeTrue();
    expect(needsResync({ since: n('3'), minSeq: n('5'), currentSeq: n('10') })).toBeTrue();
  });

  it('continues normally when the cursor is inside or beyond the retained window', () => {
    expect(needsResync({ since: n('5'), minSeq: n('5'), currentSeq: n('10') })).toBeFalse();
    expect(needsResync({ since: n('7'), minSeq: n('5'), currentSeq: n('10') })).toBeFalse();
    expect(needsResync({ since: n('10'), minSeq: n('5'), currentSeq: n('10') })).toBeFalse();
  });

  it('flags an impossible cursor beyond the counter (defensive)', () => {
    expect(needsResync({ since: n('11'), minSeq: n('5'), currentSeq: n('10') })).toBeTrue();
    expect(needsResync({ since: n('1'), minSeq: null, currentSeq: n('0') })).toBeTrue();
  });

  it('with nothing retained, any lag resyncs and tip-equality does not', () => {
    expect(needsResync({ since: n('0'), minSeq: null, currentSeq: n('0') })).toBeFalse();
    expect(needsResync({ since: n('9'), minSeq: null, currentSeq: n('10') })).toBeTrue();
    expect(needsResync({ since: n('10'), minSeq: null, currentSeq: n('10') })).toBeFalse();
  });

  it('accepts seqs up to the pg bigint ceiling', () => {
    expect(
      needsResync({ since: MAX_SYNC_SEQ, minSeq: MAX_SYNC_SEQ, currentSeq: MAX_SYNC_SEQ }),
    ).toBeFalse();
  });
});
