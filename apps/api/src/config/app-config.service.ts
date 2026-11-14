import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from './env.schema';
import { loadConfig } from './load-config';

/** DI token carrying the validated, typed application config. */
export const APP_CONFIG = Symbol('ARCDROP_APP_CONFIG');

export const appConfigProvider = {
  provide: APP_CONFIG,
  useFactory: (): AppConfig => loadConfig(),
};

/**
 * Typed façade over the validated `AppConfig`. Everything injects this (never
 * `process.env`) so config is validated exactly once and test-bootstraps can
 * override the `APP_CONFIG` token wholesale.
 */
@Injectable()
export class AppConfigService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** The full validated config object (read-only by convention). */
  get snapshot(): Readonly<AppConfig> {
    return this.config;
  }

  get port(): number {
    return this.config.port;
  }

  get databaseUrl(): string {
    return this.config.database.url;
  }

  get jwtSecret(): string {
    return this.config.jwt.secret;
  }

  /** Browser origins allowed by the CORS allowlist; empty = CORS disabled. */
  get corsOrigins(): readonly string[] {
    return this.config.cors.origins;
  }

  get dataDir(): string {
    return this.config.dataDir;
  }

  get metadataEnabled(): boolean {
    return this.config.metadata.enabled;
  }

  /** TEST/DEV affordance — see `env.schema.ts`. Never enable in production. */
  get metadataAllowPrivate(): boolean {
    return this.config.metadata.allowPrivate;
  }

  get metricsEnabled(): boolean {
    return this.config.metrics.enabled;
  }

  /** Per-PAT request budget per minute (M7) — see `env.schema.ts`. */
  get patRequestsPerMinute(): number {
    return this.config.mcp.patRequestsPerMinute;
  }

  /** M8 import cap for a single uploaded file (bytes) — see `env.schema.ts`. */
  get portabilityImportMaxBytes(): number {
    return this.config.portability.importMaxBytes;
  }

  /** M8 import cap for ZIP uploads (bytes) — see `env.schema.ts`. */
  get portabilityImportZipMaxBytes(): number {
    return this.config.portability.importZipMaxBytes;
  }

  /** M9 per-user import rate limit per minute. */
  get rateLimitImportPerMinute(): number {
    return this.config.rateLimit.importPerMinute;
  }

  /** M9 per-user reindex rate limit per minute. */
  get rateLimitReindexPerMinute(): number {
    return this.config.rateLimit.reindexPerMinute;
  }

  /** M9 per-user MCP tools/call rate limit per minute. */
  get rateLimitMcpToolsPerMinute(): number {
    return this.config.rateLimit.mcpToolsPerMinute;
  }

  /** M13 per-user bulk operations rate limit per minute. */
  get rateLimitBulkPerMinute(): number {
    return this.config.rateLimit.bulkPerMinute;
  }

  /** M19 global per-IP rate limit per minute across `/public/*` routes. */
  get rateLimitPublicPerMinute(): number {
    return this.config.rateLimit.publicPerMinute;
  }

  get logLevel(): string {
    return this.config.log.level;
  }
}
