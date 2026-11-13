/**
 * RFC 7807 problem details contract (plan D9).
 *
 * Every error response is `application/problem+json` with:
 * - `code`  — machine-readable, stable, SCREAMING_SNAKE identifier
 * - `detail`— human-readable explanation
 * - `type`  — stable problem URI derived from the code
 * plus RFC 7807 standard fields (`title`, `status`, `instance`) and the
 * `requestId` extension for log correlation.
 */
export const PROBLEM_BASE_URL = 'https://arcdrop.dev/problems';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance?: string;
  requestId?: string;
  /** Field-level details; present for validation failures. */
  errors?: Array<{ field: string; messages: string[] }>;
}

interface StatusProblem {
  code: string;
  title: string;
}

/**
 * Stable status → (code, title) mapping. Unknown statuses fall back to a
 * deterministic `HTTP_<status>` code so new exception types still produce a
 * machine-readable identifier.
 */
const STATUS_MAP: ReadonlyMap<number, StatusProblem> = new Map([
  [400, { code: 'BAD_REQUEST', title: 'Bad Request' }],
  [401, { code: 'UNAUTHORIZED', title: 'Unauthorized' }],
  [403, { code: 'FORBIDDEN', title: 'Forbidden' }],
  [404, { code: 'NOT_FOUND', title: 'Not Found' }],
  [405, { code: 'METHOD_NOT_ALLOWED', title: 'Method Not Allowed' }],
  [406, { code: 'NOT_ACCEPTABLE', title: 'Not Acceptable' }],
  [409, { code: 'CONFLICT', title: 'Conflict' }],
  [410, { code: 'GONE', title: 'Gone' }],
  [413, { code: 'PAYLOAD_TOO_LARGE', title: 'Payload Too Large' }],
  [415, { code: 'UNSUPPORTED_MEDIA_TYPE', title: 'Unsupported Media Type' }],
  [422, { code: 'UNPROCESSABLE_CONTENT', title: 'Unprocessable Content' }],
  [429, { code: 'TOO_MANY_REQUESTS', title: 'Too Many Requests' }],
  [500, { code: 'INTERNAL_ERROR', title: 'Internal Server Error' }],
  [501, { code: 'NOT_IMPLEMENTED', title: 'Not Implemented' }],
  [503, { code: 'SERVICE_UNAVAILABLE', title: 'Service Unavailable' }],
  [504, { code: 'GATEWAY_TIMEOUT', title: 'Gateway Timeout' }],
]);

export function problemForStatus(status: number): StatusProblem {
  const known = STATUS_MAP.get(status);
  if (known) return known;
  return status >= 500
    ? { code: `HTTP_${status}`, title: 'Server Error' }
    : { code: `HTTP_${status}`, title: 'Request Error' };
}

/** Stable problem URI for a code, e.g. `NOT_FOUND` → `.../problems/not-found`. */
export function problemTypeUri(code: string): string {
  return `${PROBLEM_BASE_URL}/${code.toLowerCase().replaceAll('_', '-')}`;
}
