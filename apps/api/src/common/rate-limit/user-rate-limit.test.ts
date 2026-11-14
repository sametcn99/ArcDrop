import { describe, expect, it } from 'bun:test';
import { FixedWindowRateLimiter } from './user-rate-limit.service';

describe('FixedWindowRateLimiter (M9 per-user expensive-route budgets)', () => {
  it('allows up to the configured limit and blocks limit+1 in the same window', () => {
    const now = 1_000;
    const limiter = new FixedWindowRateLimiter(3, () => now);
    expect(limiter.exceeds('user-1')).toBe(false);
    expect(limiter.exceeds('user-1')).toBe(false);
    expect(limiter.exceeds('user-1')).toBe(false);
    expect(limiter.exceeds('user-1')).toBe(true);
    expect(limiter.exceeds('user-1')).toBe(true);
  });

  it('isolates different users independently', () => {
    const limiter = new FixedWindowRateLimiter(1, () => 0);
    expect(limiter.exceeds('user-a')).toBe(false);
    expect(limiter.exceeds('user-a')).toBe(true);
    expect(limiter.exceeds('user-b')).toBe(false);
  });

  it('resets after 60 seconds', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(1, () => now);
    expect(limiter.exceeds('user-1')).toBe(false);
    expect(limiter.exceeds('user-1')).toBe(true);
    now = 59_999;
    expect(limiter.exceeds('user-1')).toBe(true);
    now = 60_000;
    expect(limiter.exceeds('user-1')).toBe(false);
  });
});
