import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/app-config.module';
import { LoggingModule } from './logging/logging.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { ProblemJsonFilter } from './common/problem-json/problem-json.filter';

/**
 * ArcDrop API root module (plan M1 — API foundation, M2 — auth & users).
 *
 * Import order matters for DI resolution: config first, then logging (so the
 * pino-backed Nest logger exists before anything logs), then infrastructure
 * and features. `ThrottlerModule` is global; its guard is registered inside
 * `AuthModule` (as the first APP_GUARD, ahead of auth/roles).
 */
@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    // Global default: 100 requests per minute per IP. `/auth/*` overrides
    // this with a strict 10/min (see AuthController).
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] }),
    HealthModule,
    MetricsModule,
    AuthModule,
    UsersModule,
    SettingsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ProblemJsonFilter }],
})
export class AppModule {}
