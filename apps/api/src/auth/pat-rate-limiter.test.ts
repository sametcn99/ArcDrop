import { describe, expect, it } from 'bun:test';
import { PatRateLimiter } from './guards/pat-scope.guard';

describe('PatRateLimiter (M7 per-PAT budget)', () => {
  it('allows up to the limit, then refuses within the same window', () => {
    const now = 0;
    const limiter = new PatRateLimiter(3, () => now);
    expect(limiter.exceeds('pat-1')).toBe(false);
    expect(limiter.exceeds('pat-1')).toBe(false);
    expect(limiter.exceeds('pat-1')).toBe(false);
    expect(limiter.exceeds('pat-1')).toBe(true);
    expect(limiter.exceeds('pat-1')).toBe(true);
  });

  it('tracks each token independently', () => {
    const now = 0;
    const limiter = new PatRateLimiter(1, () => now);
    expect(limiter.exceeds('pat-a')).toBe(false);
    expect(limiter.exceeds('pat-a')).toBe(true);
    expect(limiter.exceeds('pat-b')).toBe(false);
  });

  it('opens a fresh window after 60 seconds', () => {
    let now = 0;
    const limiter = new PatRateLimiter(1, () => now);
    expect(limiter.exceeds('pat-1')).toBe(false);
    expect(limiter.exceeds('pat-1')).toBe(true);
    now = 59_999;
    expect(limiter.exceeds('pat-1')).toBe(true);
    now = 60_000;
    expect(limiter.exceeds('pat-1')).toBe(false);
    expect(limiter.exceeds('pat-1')).toBe(true);
  });

  it('the boundary is exact: exactly-limit requests pass, limit+1 refuses', () => {
    const now = 0;
    const limiter = new PatRateLimiter(300, () => now);
    for (let i = 0; i < 300; i++) expect(limiter.exceeds('pat-1')).toBe(false);
    expect(limiter.exceeds('pat-1')).toBe(true);
  });

  it('exposes the configured limit (the guard rebuilds on config change)', () => {
    expect(new PatRateLimiter(7).limit).toBe(7);
  });
});
