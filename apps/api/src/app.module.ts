import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/app-config.module';
import { LoggingModule } from './logging/logging.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { ChangeLogModule } from './change-log/change-log.module';
import { AuditModule } from './audit/audit.module';
import { TokensModule } from './tokens/tokens.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { CollectionsModule } from './collections/collections.module';
import { FilesModule } from './files/files.module';
import { MetadataModule } from './metadata/metadata.module';
import { SyncModule } from './sync/sync.module';
import { McpModule } from './mcp/mcp.module';
import { PortabilityModule } from './portability/portability.module';
import { LibraryHealthModule } from './library-health/library-health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProblemJsonFilter } from './common/problem-json/problem-json.filter';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';

/**
 * ArcDrop API root module (plan M1 — API foundation, M2 — auth & users,
 * M3 — bookmarks core, M4 — collections, M5 — sync, M6 — metadata & icons,
 * M7 — MCP server + personal access tokens + audit, M8 — portability,
 * M9 — hardening & ops, M10 — enrichment, M11 — search operators,
 * M12 — library health, M13 — bulk ops, M14 — reminders & notifications,
 * M15 — 2FA & account lifecycle, M16 — manual ordering,
 * M17 — archive & full-text search, M18 — file uploads).
 *
 * Import order matters for DI resolution: config first, then logging (so the
 * pino-backed Nest logger exists before anything logs), then infrastructure
 * and features. `ThrottlerModule` is global; its guard is registered inside
 * `AuthModule` (as the first APP_GUARD, ahead of auth/pat-scope/roles).
 * `RateLimitModule` provides per-user budgets for expensive authenticated
 * routes (`import`, `reindex`, `mcpTools`).
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    RateLimitModule,
    // Global default: 100 requests per minute per IP. `/auth/*` overrides
    // this with a strict 10/min (see AuthController).
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    ScheduleModule.forRoot(),
    HealthModule,
    MetricsModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    ChangeLogModule,
    FilesModule,
    MetadataModule,
    AuditModule,
    TokensModule,
    BookmarksModule,
    CollectionsModule,
    SyncModule,
    NotificationsModule,
    LibraryHealthModule,
    McpModule,
    PortabilityModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemJsonFilter }],
})
export class AppModule {}
