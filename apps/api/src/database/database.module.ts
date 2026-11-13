import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '@api/config/app-config.service';
import { buildDataSourceOptions } from './data-source';

/**
 * Infrastructure module exposing the configured TypeORM `DataSource` (plan
 * D1/D11: PostgreSQL only, migrations via the TypeORM CLI, `synchronize`
 * always off). `TypeOrmModule.forRootAsync` registers the DataSource as a
 * global provider — inject it with `@InjectDataSource()`.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => buildDataSourceOptions(config.snapshot),
    }),
  ],
})
export class DatabaseModule {}
