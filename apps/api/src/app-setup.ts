import type { INestApplication } from '@nestjs/common';
import { VersioningType } from '@nestjs/common';
import type { Express, Request, Response } from 'express';
import { json } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { WsAdapter } from '@nestjs/platform-ws';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from '@api/config/env.schema';
import { AppConfigService } from '@api/config/app-config.service';
import {
  enrichOpenApiWithProblemResponses,
  ProblemDetailsDto,
  ProblemFieldErrorDto,
} from '@api/common/problem-json/problem-details.dto';
import { createValidationPipe } from '@api/common/validation';
import { MetricsService } from '@api/metrics/metrics.service';
import pkg from '../package.json';

/**
 * Shared application wiring — used by BOTH the production bootstrap
 * (`main.ts`) and the e2e test boots, so tests exercise the exact runtime
 * configuration: pino logger, `/api` prefix + URI versioning, the global
 * validation pipe, the CORS allowlist, shutdown hooks, the ws adapter
 * (M5's sync gateway — raw `ws`), the OpenAPI document and the root-level
 * infrastructure routes.
 */
export function setupApp(app: INestApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(createValidationPipe());
  // Route-scoped JSON body limits (M9 revisit of M8's 2 MB global cap):
  // Only `/api/v1/mcp` accepts base64-encoded import/file payloads (1 MiB decoded +
  // base64 + JSON-RPC envelope -> 2 MB). All other JSON endpoints carry small
  // DTOs and stay capped at 256 KB; multipart uploads use their own dynamic
  // byte caps (`settings.fileMaxBytes`, `ARCDROP__PORTABILITY__IMPORT*_MAX_BYTES`).
  // `express.json` skips requests already marked `req._body = true`, so
  // mounting `/api/v1/mcp` first gives it 2 MB and lets the 256 KB fallback
  // handle the rest of the API.
  app.use('/api/v1/mcp', json({ limit: '2mb' }));
  app.use(json({ limit: '256kb' }));
  // The sync ws gateway (M5) rides the same HTTP server via the raw-`ws`
  // adapter. Must be set before init — same discipline as the routes below.
  app.useWebSocketAdapter(new WsAdapter(app));
  if (config.cors.origins.length > 0) {
    app.enableCors({ origin: [...config.cors.origins] });
  }
  app.enableShutdownHooks();
}

/**
 * Builds the OpenAPI 3 document from the compiled module.
 *
 * Operation-ID convention (contract discipline, plan D9): every route sets an
 * EXPLICIT `@ApiOperation({ operationId: '<camelCaseVerb><Resource>' })` —
 * stable IDs are what all four clients generate code from. The e2e suite
 * fails the build if any operation is missing one.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const openApiConfig = new DocumentBuilder()
    .setTitle('ArcDrop API')
    .setDescription(
      'REST API for ArcDrop — self-hosted, multi-user bookmark platform. ' +
        'All routes are versioned under `/api/v1` (URI versioning) and errors ' +
        'are RFC 7807 `application/problem+json` with a machine-readable `code`.',
    )
    .setVersion(pkg.version)
    .setLicense('MIT', 'https://github.com/sametcn99/ArcDrop/blob/main/LICENSE')
    .addTag('System', 'Health, readiness and service metadata')
    .addTag('Auth', 'Bootstrap, login, TOTP 2FA, refresh rotation, sessions, invite/reset claim')
    .addTag('Account', 'Account lifecycle — library reset and self-delete (plan M15)')
    .addTag('Users', 'Admin user management (invite/reset tokens via API, plan D15)')
    .addTag('Settings', 'Admin instance settings (plan D16)')
    .addTag('Audit', 'Admin audit trail over admin actions and MCP tool calls (plan M9)')
    .addTag(
      'Bookmarks',
      'Bookmark CRUD, file uploads, trash/restore, search + paging, stats, per-bookmark tags',
    )
    .addTag('Tags', 'Tag rename/merge and delete-detach (plan M3)')
    .addTag('Sync', 'Change-log sync: state poll, cursor deltas, ws push + tickets (plan M5/D4)')
    .addTag(
      'Notifications',
      'Reminder notifications inbox and read receipts (ws-only live delivery, plan M14/D20)',
    )
    .addTag('Metadata', 'SSRF-hardened metadata enrichment + reindex (plan M6)')
    .addTag('Icons', 'Public unguessable icon cache (plan M6/D18)')
    .addTag('Files', 'Private authenticated user-uploaded file serving (plan M18/D19)')
    .addTag('Tokens', 'Personal access tokens — agent auth (plan M7/D23)')
    .addTag(
      'Portability',
      'Export/import: JSON/CSV/HTML/TXT/ENEX/ZIP with URL-keyed upsert (plan M8/M18)',
    )
    .addTag('MCP', 'Model Context Protocol endpoint: the app surface as agent tools (plan M7/D23)')
    // Bearer auth (plan D2): `Authorization: Bearer <access JWT>` (or PAT where allowed).
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig, {
    extraModels: [ProblemDetailsDto, ProblemFieldErrorDto],
  });
  return enrichOpenApiWithProblemResponses(document);
}

export interface InfrastructureRoutesOptions {
  document: OpenAPIObject;
  config: AppConfig;
}

/**
 * Registers the root-level (unprefixed, unversioned) infrastructure routes on
 * the underlying Express instance: `/openapi.json`, `/docs` (Scalar UI) and —
 * when enabled in config — `/metrics`. Must run before `app.init()` so the
 * routes precede Nest's catch-all router in the middleware chain.
 */
export function registerInfrastructureRoutes(
  app: INestApplication,
  { document, config }: InfrastructureRoutesOptions,
): void {
  const server = app.getHttpAdapter().getInstance() as Express;
  const logger = app.get(Logger);

  server.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(document);
  });

  // Scalar standalone page reading the locally-served document. The UI
  // bundle itself comes from the CDN (documented in the README); the
  // OpenAPI document and codegen never depend on it.
  const scalarHtml = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <title>ArcDrop API — Scalar</title>',
    '  </head>',
    '  <body>',
    '    <script id="api-reference" data-url="/openapi.json"></script>',
    '    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>',
    '  </body>',
    '</html>',
  ].join('\n');
  server.get('/docs', (_req: Request, res: Response) => {
    res.type('html').send(scalarHtml);
  });

  if (config.metrics.enabled) {
    const metrics = app.get(MetricsService);
    server.get('/metrics', (_req: Request, res: Response) => {
      void metrics.render().then(
        (body) => {
          res.type(metrics.contentType).send(body);
        },
        (error: unknown) => {
          logger.error(`metrics collection failed: ${(error as Error).message}`);
          res.status(500).send('metrics collection failed');
        },
      );
    });
  }
}

/** Convenience accessor for tests that need the config service off the app. */
export function appConfigOf(app: INestApplication): AppConfigService {
  return app.get(AppConfigService);
}
