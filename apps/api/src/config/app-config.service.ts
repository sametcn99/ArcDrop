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

  get metricsEnabled(): boolean {
    return this.config.metrics.enabled;
  }

  get logLevel(): string {
    return this.config.log.level;
  }
}
