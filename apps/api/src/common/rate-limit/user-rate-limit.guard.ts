import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { USER_RATE_LIMIT_KEY, type UserRateLimitMetadata } from './user-rate-limit.decorator';
import { UserRateLimitService } from './user-rate-limit.service';

/**
 * Route-level guard enforcing per-user rate budgets on expensive endpoints
 * (`import`, `reindex`, `mcpTools`). Executes after global `APP_GUARD`s so
 * `request.user` is guaranteed to be populated.
 */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: UserRateLimitService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<UserRateLimitMetadata>(USER_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user) return true;

    if (meta.jsonRpcMethod !== undefined) {
      if (request.method.toUpperCase() !== 'POST') return true;
      const body = request.body as { method?: unknown } | undefined;
      if (body?.method !== meta.jsonRpcMethod) return true;
    }

    this.limiter.assertWithinLimit(meta.bucket, user.id);
    return true;
  }
}
