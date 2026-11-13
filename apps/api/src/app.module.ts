import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/app-config.module';
import { LoggingModule } from './logging/logging.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { ProblemJsonFilter } from './common/problem-json/problem-json.filter';

/**
 * ArcDrop API root module (plan M1 — API foundation).
 *
 * Import order matters for DI resolution: config first, then logging (so the
 * pino-backed Nest logger exists before anything logs), then infrastructure
 * and features.
 */
@Module({
  imports: [AppConfigModule, LoggingModule, DatabaseModule, HealthModule, MetricsModule],
  providers: [{ provide: APP_FILTER, useClass: ProblemJsonFilter }],
})
export class AppModule {}
