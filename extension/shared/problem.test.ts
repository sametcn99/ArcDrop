import { describe, expect, it } from 'bun:test';
import { ApiError, isTotpRequiredError, parseProblemDetails, toApiError } from './problem';

describe('parseProblemDetails', () => {
  it('parses a full ArcDrop problem document', () => {
    const parsed = parseProblemDetails({
      type: 'https://arcdrop.dev/problems/invalid-credentials',
      title: 'Invalid credentials',
      status: 401,
      code: 'INVALID_CREDENTIALS',
      detail: 'Wrong email or password.',
      requestId: 'req-1',
      errors: [{ field: 'password', messages: ['must be 8–128 characters'] }],
    });
    expect(parsed).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      status: 401,
      requestId: 'req-1',
      errors: [{ field: 'password', messages: ['must be 8–128 characters'] }],
    });
  });

  it('returns null for non-problem bodies', () => {
    expect(parseProblemDetails(null)).toBeNull();
    expect(parseProblemDetails('oops')).toBeNull();
    expect(parseProblemDetails({ message: 'nope' })).toBeNull();
    expect(parseProblemDetails({ title: 'half' })).toBeNull();
  });

  it('falls back to title for a missing detail', () => {
    const parsed = parseProblemDetails({ title: 'Boom', status: 500, code: 'X' });
    expect(parsed?.detail).toBe('Boom');
  });
});

describe('isTotpRequiredError', () => {
  it('matches a TOTP_REQUIRED problem carrying a challenge', () => {
    const error = new ApiError({
      type: 'https://arcdrop.dev/problems/totp-required',
      title: 'TOTP required',
      status: 401,
      code: 'TOTP_REQUIRED',
      detail: 'Enter your authenticator code.',
      challenge: 'c-token',
      expiresAt: '2026-01-01T00:05:00Z',
    });
    expect(isTotpRequiredError(error)).toBe(true);
  });

  it('rejects TOTP_REQUIRED without a challenge and other codes', () => {
    const bare = new ApiError({
      type: 't',
      title: 't',
      status: 401,
      code: 'TOTP_REQUIRED',
      detail: 'no challenge',
    });
    expect(isTotpRequiredError(bare)).toBe(false);
    expect(isTotpRequiredError(new Error('plain'))).toBe(false);
  });
});

describe('toApiError', () => {
  it('passes ApiErrors through', () => {
    const original = new ApiError({
      type: 't',
      title: 'T',
      status: 429,
      code: 'RATE_LIMITED',
      detail: 'slow down',
    });
    expect(toApiError(original)).toBe(original);
  });

  it('wraps transport failures as NETWORK_ERROR', () => {
    const wrapped = toApiError(new TypeError('Failed to fetch'));
    expect(wrapped).toBeInstanceOf(ApiError);
    expect(wrapped.code).toBe('NETWORK_ERROR');
    expect(wrapped.status).toBe(0);
  });
});
