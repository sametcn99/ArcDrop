// ProblemJSON handling for the ArcDrop extension.
// Mirrors apps/web/app/src/api/schemas/problem.ts (kept in sync by hand —
// the extension installs its own dependencies outside the root workspace,
// so cross-project imports are deliberately avoided).

export interface ProblemFieldError {
  field: string;
  messages: string[];
}

/**
 * RFC 9457-style problem details as emitted by the ArcDrop API
 * (apps/api/src/common/problem-json). Only fields the extension acts on
 * are modeled; unknown members may exist on the wire.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance?: string;
  requestId?: string;
  errors?: ProblemFieldError[];
  /** Short-lived 2FA challenge token (present when code === 'TOTP_REQUIRED'). */
  challenge?: string;
  /** ISO-8601 expiry for `challenge`. */
  expiresAt?: string;
}

/**
 * Structural guard for a problem body. Deliberately lenient (no schema
 * library): the API is the single producer and the web client validates the
 * same shape with zod.
 */
export function parseProblemDetails(raw: unknown): ProblemDetails | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (
    typeof record['title'] !== 'string' ||
    typeof record['status'] !== 'number' ||
    typeof record['code'] !== 'string'
  ) {
    return null;
  }

  const problems: ProblemDetails = {
    type:
      typeof record['type'] === 'string' ? record['type'] : `https://arcdrop.dev/problems/unknown`,
    title: record['title'],
    status: record['status'],
    code: record['code'],
    detail: typeof record['detail'] === 'string' ? record['detail'] : record['title'],
  };

  if (typeof record['instance'] === 'string') problems.instance = record['instance'];
  if (typeof record['requestId'] === 'string') problems.requestId = record['requestId'];
  if (typeof record['challenge'] === 'string') problems.challenge = record['challenge'];
  if (typeof record['expiresAt'] === 'string') problems.expiresAt = record['expiresAt'];

  if (Array.isArray(record['errors'])) {
    const fieldErrors: ProblemFieldError[] = [];
    for (const entry of record['errors']) {
      if (typeof entry !== 'object' || entry === null) continue;
      const error = entry as Record<string, unknown>;
      if (typeof error['field'] !== 'string' || !Array.isArray(error['messages'])) continue;
      const messages = error['messages'].filter((m): m is string => typeof m === 'string');
      fieldErrors.push({ field: error['field'], messages });
    }
    if (fieldErrors.length > 0) problems.errors = fieldErrors;
  }

  return problems;
}

export interface ApiErrorOptions {
  retryAfterSeconds?: number;
}

/** Error thrown by the fetch layer; mirrors the web client's ApiError. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly type: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly errors?: ProblemFieldError[];
  readonly retryAfterSeconds?: number;
  readonly challenge?: string;
  readonly expiresAt?: string;
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails, options: ApiErrorOptions = {}) {
    super(problem.detail);
    this.name = 'ApiError';
    this.status = problem.status;
    this.code = problem.code;
    this.title = problem.title;
    this.detail = problem.detail;
    this.type = problem.type;
    this.instance = problem.instance;
    this.requestId = problem.requestId;
    this.errors = problem.errors;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.challenge = problem.challenge;
    this.expiresAt = problem.expiresAt;
    this.problem = problem;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** True when a login attempt bounced into the two-factor challenge step. */
export function isTotpRequiredError(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.code === 'TOTP_REQUIRED' &&
    typeof error.challenge === 'string' &&
    error.challenge.length > 0 &&
    typeof error.expiresAt === 'string' &&
    error.expiresAt.length > 0
  );
}

export function toApiError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }
  const message = error instanceof Error ? error.message : 'Unexpected network or client error';
  return new ApiError({
    type: 'https://arcdrop.dev/problems/client-error',
    title: 'Request Failed',
    status: 0,
    code: 'NETWORK_ERROR',
    detail: message,
  });
}
