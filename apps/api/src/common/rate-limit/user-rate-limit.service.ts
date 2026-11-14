import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { AppConfigService } from '@api/config/app-config.service';
import type { UserRateLimitBucket } from './user-rate-limit.decorator';

const WINDOW_MS = 60_000;

/**
 * In-memory fixed-window rate limiter per (bucket, userId) key (M9).
 * Single-instance posture consistent with `PatRateLimiter` and ws tickets;
 * expired entries are pruned opportunistically when the map grows.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; startedAt: number }>();

  constructor(
    readonly limit: number,
    private readonly now: () => number = Date.now,
  ) {}

  exceeds(key: string): boolean {
    const current = this.now();
    const existing = this.windows.get(key);
    if (!existing || current - existing.startedAt >= WINDOW_MS) {
      if (this.windows.size > 10_000) {
        for (const [k, entry] of this.windows) {
          if (current - entry.startedAt >= WINDOW_MS) this.windows.delete(k);
        }
      }
      this.windows.set(key, { count: 1, startedAt: current });
      return false;
    }
    existing.count += 1;
    return existing.count > this.limit;
  }
}

const BUCKET_LABELS: Record<UserRateLimitBucket, string> = {
  import: 'Import rate limit exceeded (try again within a minute)',
  reindex: 'Metadata reindex rate limit exceeded (try again within a minute)',
  mcpTools: 'MCP tool-call rate limit exceeded (try again within a minute)',
  bulk: 'Bulk operation rate limit exceeded (try again within a minute)',
};

@Injectable()
export class UserRateLimitService {
  private readonly limiters = new Map<UserRateLimitBucket, FixedWindowRateLimiter>();

  constructor(private readonly config: AppConfigService) {}

  assertWithinLimit(bucket: UserRateLimitBucket, userId: string): void {
    const limit = this.limitFor(bucket);
    let limiter = this.limiters.get(bucket);
    if (limiter?.limit !== limit) {
      limiter = new FixedWindowRateLimiter(limit);
      this.limiters.set(bucket, limiter);
    }
    if (limiter.exceeds(userId)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: BUCKET_LABELS[bucket],
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private limitFor(bucket: UserRateLimitBucket): number {
    switch (bucket) {
      case 'import':
        return this.config.rateLimitImportPerMinute;
      case 'reindex':
        return this.config.rateLimitReindexPerMinute;
      case 'mcpTools':
        return this.config.rateLimitMcpToolsPerMinute;
      case 'bulk':
        return this.config.rateLimitBulkPerMinute;
    }
  }
}
