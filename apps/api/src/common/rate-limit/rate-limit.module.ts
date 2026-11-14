import { Global, Module } from '@nestjs/common';
import { UserRateLimitGuard } from './user-rate-limit.guard';
import { UserRateLimitService } from './user-rate-limit.service';

/**
 * Shared per-user rate-limiting infrastructure (M9) for expensive routes
 * (`POST /data/import`, `POST /bookmarks/:id/reindex`, `POST /mcp` tools/call).
 */
@Global()
@Module({
  providers: [UserRateLimitService, UserRateLimitGuard],
  exports: [UserRateLimitService, UserRateLimitGuard],
})
export class RateLimitModule {}
