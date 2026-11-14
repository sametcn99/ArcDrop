import { SetMetadata } from '@nestjs/common';

export type UserRateLimitBucket = 'import' | 'reindex' | 'mcpTools' | 'bulk';

export const USER_RATE_LIMIT_KEY = 'arcdrop:user_rate_limit';

export interface UserRateLimitMetadata {
  bucket: UserRateLimitBucket;
  /** When set, only POST requests whose JSON-RPC `method` matches are counted. */
  jsonRpcMethod?: string;
}

/**
 * Applies a per-user fixed-window rate limit (M9/M13) to an authenticated route.
 * Runs after `JwtAuthGuard` + `PatScopeGuard` so `request.user.id` is set.
 */
export const UserRateLimit = (
  bucket: UserRateLimitBucket,
  options?: { jsonRpcMethod?: string },
): MethodDecorator & ClassDecorator =>
  SetMetadata(USER_RATE_LIMIT_KEY, {
    bucket,
    ...(options?.jsonRpcMethod ? { jsonRpcMethod: options.jsonRpcMethod } : {}),
  } satisfies UserRateLimitMetadata);
