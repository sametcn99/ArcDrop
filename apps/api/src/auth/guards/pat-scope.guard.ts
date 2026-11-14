import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppConfigService } from '@api/config/app-config.service';
import type { RequestUser } from '../decorators/current-user.decorator';
import { PAT_SCOPE_DEFERRED_KEY } from '../decorators/pat-scope-deferred.decorator';

const HTTP_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Per-PAT fixed-window rate limiter (M7). Requests a single personal access
 * token may make per minute — REST and MCP combined. The budget is
 * intentionally ABOVE the global per-IP budget (100/min) so it only bites
 * when ONE token is used from MANY addresses: the stolen-token scenario the
 * per-IP limit cannot see. In-memory fixed window — same posture as the ws
 * ticket store (v1 is single-instance; a restart clears the window).
 */
export class PatRateLimiter {
  readonly limit: number;
  private readonly windows = new Map<string, { count: number; startedAt: number }>();

  constructor(
    limitPerMinute: number,
    private readonly now: () => number = Date.now,
  ) {
    this.limit = limitPerMinute;
  }

  /** Consume one request for `key`; returns true when the budget is exceeded. */
  exceeds(key: string): boolean {
    const minute = 60_000;
    const current = this.now();
    const window = this.windows.get(key);
    if (!window || current - window.startedAt >= minute) {
      this.windows.set(key, { count: 1, startedAt: current });
      return false;
    }
    window.count += 1;
    return window.count > this.limit;
  }
}

/**
 * Personal-access-token surface rules (plan M7). Runs after `JwtAuthGuard`
 * (which resolves the principal, JWT or PAT) and before `RolesGuard`:
 *
 * 1. `/auth/*` is unreachable via PAT — a PAT is a credential, not a
 *    session; it must never rotate, log out, list, or change sessions.
 * 2. `/admin/*` is unreachable via PAT — admin tooling stays session-only
 *    ("no admin tools via PAT by default", even for an admin's own token).
 * 3. Read-only tokens may only use HTTP-safe methods (GET/HEAD/OPTIONS);
 *    every mutating REST route is refused at this guard level. The MCP
 *    endpoint opts out via `@PatScopeDeferred()` (every tool call is an
 *    HTTP POST) and enforces read-only per TOOL instead.
 * 4. Every PAT request counts against the per-token rate budget; excess is
 *    a 429.
 */
@Injectable()
export class PatScopeGuard implements CanActivate {
  private limiter?: PatRateLimiter;

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user || user.authKind !== 'pat') return true;

    // Controller-metadata based surface rules — immune to global-prefix and
    // versioning mount details (no request-path string sniffing).
    const controllerPath = this.reflector.get<string>(PATH_METADATA, context.getClass()) ?? '';
    const firstSegment = controllerPath.split('/')[0] ?? '';
    if (firstSegment === 'auth') {
      throw new ForbiddenException('The auth surface is not reachable via personal access tokens');
    }
    if (firstSegment === 'admin') {
      throw new ForbiddenException('The admin surface is not reachable via personal access tokens');
    }

    if (this.exceedsRateLimit(user)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Personal access token rate limit exceeded (try again within a minute)',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const deferred = this.reflector.getAllAndOverride<boolean>(PAT_SCOPE_DEFERRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (
      user.patReadOnly === true &&
      !deferred &&
      !HTTP_SAFE_METHODS.has(request.method.toUpperCase())
    ) {
      throw new ForbiddenException(
        'This personal access token is scope=read-only and cannot perform mutations',
      );
    }
    return true;
  }

  private exceedsRateLimit(user: RequestUser): boolean {
    const limit = this.config.patRequestsPerMinute;
    // The limiter instance is per-app; rebuild only when the configured
    // limit changes (e2e boots per config).
    if (this.limiter?.limit !== limit) {
      this.limiter = new PatRateLimiter(limit);
    }
    return this.limiter.exceeds(user.patId ?? user.id);
  }
}
