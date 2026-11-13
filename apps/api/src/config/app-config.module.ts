import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadConfig } from './load-config';
import { appConfigProvider, AppConfigService } from './app-config.service';

/**
 * Root configuration module.
 *
 * `@nestjs/config` is wired with `ignoreEnvFile` (variables come from the
 * process environment only) and a `load` factory that runs the same zod
 * validation as boot, so `ConfigService` consumers see the nested, validated
 * shape (`database.url`, `jwt.secret`, …). The typed surface is
 * `AppConfigService` + the `APP_CONFIG` token.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      load: [(): ReturnType<typeof loadConfig> => loadConfig()],
    }),
  ],
  providers: [appConfigProvider, AppConfigService],
  exports: [appConfigProvider, AppConfigService],
})
export class AppConfigModule {}
