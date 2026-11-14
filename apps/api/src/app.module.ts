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
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { CollectionsModule } from './collections/collections.module';
import { SyncModule } from './sync/sync.module';
import { ProblemJsonFilter } from './common/problem-json/problem-json.filter';

/**
 * ArcDrop API root module (plan M1 — API foundation, M2 — auth & users,
 * M3 — bookmarks core, M4 — collections, M5 — sync).
 *
 * Import order matters for DI resolution: config first, then logging (so the
 * pino-backed Nest logger exists before anything logs), then infrastructure
 * and features. `ThrottlerModule` is global; its guard is registered inside
 * `AuthModule` (as the first APP_GUARD, ahead of auth/roles). `ScheduleModule`
 * hosts the trash-purge cron (plan D17) and the change-log retention cron
 * (plan D4).
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
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
    BookmarksModule,
    CollectionsModule,
    SyncModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemJsonFilter }],
})
export class AppModule {}
