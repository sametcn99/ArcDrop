import 'reflect-metadata';
import { DataSource } from 'typeorm';
import type { DataSourceOptions } from 'typeorm';
import type { AppConfig } from '@api/config/env.schema';
import { entities } from './entities';
import { migrations } from './migrations';
import { NestTypeOrmLogger } from './typeorm-logger';

/**
 * Shared DataSource options builder — used by the Nest module (runtime) and
 * by the CLI wrapper (`data-source.cli.ts`, bundled to `dist/` for the
 * TypeORM CLI and the migrate-on-boot entrypoint).
 *
 * Discipline (plan D11): `synchronize` is ALWAYS false — schema changes go
 * through generated migrations only.
 */
export function buildDataSourceOptions(config: AppConfig): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.database.url,
    entities,
    migrations,
    synchronize: false,
    logging: ['error', 'warn', 'migration'],
    logger: new NestTypeOrmLogger(),
  };
}

export function createDataSource(config: AppConfig): DataSource {
  return new DataSource(buildDataSourceOptions(config));
}
