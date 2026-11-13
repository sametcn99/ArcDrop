import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@api/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '@api/app-setup';
import { ConfigValidationError, loadConfig } from '@api/config/load-config';
import type { AppConfig } from '@api/config/env.schema';

/**
 * Fail-fast bootstrap (plan M1):
 * 1. validate the environment (zod) — an invalid env prints a report with the
 *    original `ARCDROP__*` variable names and exits non-zero;
 * 2. ensure the data dir exists;
 * 3. create + wire the Nest app (shared `setupApp`), register the root-level
 *    infrastructure routes (`/openapi.json`, `/docs`, optional `/metrics`);
 * 4. listen on `ARCDROP__PORT`.
 */
async function bootstrap(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      process.stderr.write('✗ Invalid environment configuration — refusing to start:\n\n');
      for (const issue of error.issues) {
        process.stderr.write(`  - ${issue}\n`);
      }
      process.stderr.write('\nFix the ARCDROP__* variables above, then restart the process.\n');
      process.exit(1);
    }
    throw error;
  }

  try {
    await mkdir(config.dataDir, { recursive: true });
  } catch (error) {
    process.stderr.write(
      `✗ Data directory "${config.dataDir}" is not usable: ${(error as Error).message}\n`,
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, { logger: false });
  setupApp(app, config);
  const document = buildOpenApiDocument(app);
  registerInfrastructureRoutes(app, { document, config });
  await app.listen(config.port);

  const logger = new NestLogger('Bootstrap');
  logger.log(
    `ArcDrop API listening on ${await app.getUrl()} ` +
      `(docs: /docs, openapi: /openapi.json${config.metrics.enabled ? ', metrics: /metrics' : ''})`,
  );
}

void bootstrap();
