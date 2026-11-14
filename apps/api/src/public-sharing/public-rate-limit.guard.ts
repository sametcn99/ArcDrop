import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { FixedWindowRateLimiter } from '@api/common/rate-limit/user-rate-limit.service';
import { AppConfigService } from '@api/config/app-config.service';

/**
 * Shared global per-IP rate-limit bucket across all `/public/*` collection
 * and RSS endpoints (plan M19 / D19). Enforced against
 * `ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE` (default 60/min) so a burst against
 * unauthenticated share URLs returns 429 `application/problem+json` without
 * requiring authentication.
 */
@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  private limiter: FixedWindowRateLimiter;

  constructor(private readonly config: AppConfigService) {
    this.limiter = new FixedWindowRateLimiter(this.config.rateLimitPublicPerMinute);
  }

  canActivate(context: ExecutionContext): boolean {
    const configuredLimit = this.config.rateLimitPublicPerMinute;
    if (this.limiter.limit !== configuredLimit) {
      this.limiter = new FixedWindowRateLimiter(configuredLimit);
    }

    const request = context.switchToHttp().getRequest<Request>();
    const clientIp = request.ip || request.socket?.remoteAddress || 'unknown';
    if (this.limiter.exceeds(clientIp)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Public collection rate limit exceeded (try again within a minute)',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
