import { Logger as NestLogger } from '@nestjs/common';
import type { Logger as TypeOrmLogger, QueryRunner } from 'typeorm';

/**
 * Routes TypeORM's log channels into the app logger (pino in the server, a
 * console fallback in the migration CLI). Query logging stays off unless the
 * `query` channel is enabled in the DataSource options.
 */
export class NestTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('TypeORM');

  log(
    level: 'log' | 'info' | 'warn' | 'debug' | 'error' | 'verbose',
    message: unknown,
    _queryRunner?: QueryRunner,
  ): void {
    if (level === 'error') this.logger.error(message);
    else if (level === 'warn') this.logger.warn(message);
    else this.logger.verbose(message);
  }

  logQuery(_query: string, _parameters?: unknown[], _queryRunner?: QueryRunner): void {
    // Silent — the `query` channel is not enabled; flip it on to debug SQL.
  }

  logQueryError(
    error: string,
    query: string,
    _parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    this.logger.error(`query failed: ${error}\n${query}`);
  }

  logQuerySlow(
    time: number,
    query: string,
    _parameters?: unknown[],
    _queryRunner?: QueryRunner,
  ): void {
    this.logger.warn(`slow query (${time}ms): ${query}`);
  }

  logSchemaBuild(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(message);
  }

  logMigration(message: string, _queryRunner?: QueryRunner): void {
    this.logger.log(message);
  }
}
