import { z } from 'zod';
import type { components } from '../types';

export const problemFieldErrorSchema = z.object({
  field: z.string(),
  messages: z.array(z.string()),
});

export const problemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string(),
    detail: z.string(),
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z.array(problemFieldErrorSchema).optional(),
    challenge: z.string().optional(),
    expiresAt: z.string().optional(),
    limitBytes: z.number().optional(),
    usedBytes: z.number().optional(),
    resetAt: z.string().optional(),
  })
  .loose();

export type ProblemFieldError = z.infer<typeof problemFieldErrorSchema>;
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

// Type-level check against the generated OpenAPI ProblemDetailsDto schema.
type _OpenApiProblemDetails = components['schemas']['ProblemDetailsDto'];
const _problemCompatibilityCheck: _OpenApiProblemDetails | undefined = undefined as
  ProblemDetails | undefined;
void _problemCompatibilityCheck;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly type: string;
  readonly instance?: string;
  readonly requestId?: string;
  readonly errors?: ProblemFieldError[];
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
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
    this.problem = problem;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isTotpRequiredError(error: unknown): error is ApiError & {
  problem: ProblemDetails & { challenge: string; expiresAt: string };
} {
  return (
    isApiError(error) &&
    error.code === 'TOTP_REQUIRED' &&
    typeof error.problem.challenge === 'string' &&
    error.problem.challenge.length > 0 &&
    typeof error.problem.expiresAt === 'string' &&
    error.problem.expiresAt.length > 0
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
