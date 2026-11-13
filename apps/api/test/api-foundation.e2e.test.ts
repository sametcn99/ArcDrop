import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { InternalServerErrorException } from '@nestjs/common';
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsInt, IsString } from 'class-validator';
import type { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, registerInfrastructureRoutes, setupApp } from '../src/app-setup';
import { createDataSource } from '../src/database/data-source';
import { loadConfig } from '../src/config/load-config';
import { installTestEnv } from './helpers';

/**
 * Probe routes registered ONLY in this test module — they exist so the e2e
 * suite can exercise thrown errors and validation failures through the real
 * HTTP stack without shipping test-only routes in the application.
 */
class ProbeDto {
  @ApiProperty({ example: 'arc' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 3 })
  @IsInt()
  count!: number;
}

@ApiTags('Probe')
@Controller()
class ProbeController {
  @Get('boom')
  @ApiOperation({ operationId: 'probeBoom', summary: 'Throws a 500 for e2e tests' })
  boom(): string {
    throw new InternalServerErrorException('boom detail');
  }

  @Post('echo')
  @ApiOperation({ operationId: 'probeEcho', summary: 'Validates a DTO for e2e tests' })
  echo(@Body() dto: ProbeDto): ProbeDto {
    return dto;
  }
}

const INITIAL_MIGRATION = 'InitialSetup1763000000000';

describe('API foundation (e2e)', () => {
  beforeAll(() => {
    installTestEnv();
  });

  describe('default boot (metrics off, CORS off)', () => {
    let app: INestApplication;
    let baseUrl: string;
    let document: OpenAPIObject;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
        controllers: [ProbeController],
      }).compile();

      const config = loadConfig();
      app = moduleRef.createNestApplication({ logger: false });
      setupApp(app, config);
      document = buildOpenApiDocument(app);
      registerInfrastructureRoutes(app, { document, config });
      await app.listen(0);
      baseUrl = await app.getUrl();
    }, 30_000);

    afterAll(async () => {
      await app.close();
    });

    it('GET /api/v1/healthz reports liveness', async () => {
      const res = await fetch(`${baseUrl}/api/v1/healthz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['status']).toBe('ok');
      expect(typeof body['version']).toBe('string');
      expect(typeof body['uptimeSeconds']).toBe('number');
    });

    it('GET /api/v1/readyz passes DB + data-dir checks', async () => {
      const res = await fetch(`${baseUrl}/api/v1/readyz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; checks: Record<string, string> };
      expect(body['status']).toBe('ok');
      expect(body['checks']).toEqual({ database: 'ok', dataDir: 'ok' });
    });

    it('the initial migration is recorded in the migrations table', async () => {
      // Run migrations the way the CLI/migrate-on-boot entrypoint does.
      const runner = createDataSource(loadConfig());
      await runner.initialize();
      await runner.runMigrations();
      await runner.destroy();

      const dataSource = app.get(DataSource);
      const rows = (await dataSource.query(
        'SELECT name FROM "migrations" ORDER BY "timestamp" ASC',
      )) as Array<{ name: string }>;
      expect(rows.some((row) => row.name === INITIAL_MIGRATION)).toBe(true);
    });

    it('unknown routes return problem+json 404 with a machine-readable code', async () => {
      const res = await fetch(`${baseUrl}/api/v1/definitely-missing`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')?.startsWith('application/problem+json')).toBe(true);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['code']).toBe('NOT_FOUND');
      expect(body['title']).toBe('Not Found');
      expect(body['status']).toBe(404);
      expect(typeof body['type']).toBe('string');
      expect(body['detail']).toContain('GET');
      expect(body['instance']).toBe('/api/v1/definitely-missing');
      expect(typeof body['requestId']).toBe('string');
    });

    it('the M0 root route is gone — GET / is a problem+json 404', async () => {
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')?.startsWith('application/problem+json')).toBe(true);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['code']).toBe('NOT_FOUND');
    });

    it('thrown errors return problem+json 500', async () => {
      const res = await fetch(`${baseUrl}/api/v1/boom`);
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')?.startsWith('application/problem+json')).toBe(true);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['code']).toBe('INTERNAL_ERROR');
      expect(body['detail']).toBe('boom detail');
    });

    it('validation failures map to 400 problem+json with field details', async () => {
      const res = await fetch(`${baseUrl}/api/v1/echo`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 123, extra: 'stripped' }),
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')?.startsWith('application/problem+json')).toBe(true);
      const body = (await res.json()) as {
        code: string;
        detail: string;
        errors: Array<{ field: string; messages: string[] }>;
      };
      expect(body.code).toBe('VALIDATION_FAILED');
      const fields = body.errors.map((error) => error.field);
      expect(fields).toContain('name');
      expect(fields).not.toContain('extra'); // whitelisted away
    });

    it('request correlation IDs: incoming header is honored, otherwise a UUID is minted', async () => {
      const echoed = await fetch(`${baseUrl}/api/v1/healthz`, {
        headers: { 'x-request-id': 'e2e-correlation-42' },
      });
      expect(echoed.headers.get('x-request-id')).toBe('e2e-correlation-42');

      const minted = await fetch(`${baseUrl}/api/v1/healthz`);
      const mintedId = minted.headers.get('x-request-id');
      expect(mintedId).toBeDefined();
      expect(mintedId!.length).toBeGreaterThanOrEqual(32);
    });

    it('/openapi.json serves the document under /api/v1 with operation IDs everywhere', async () => {
      const res = await fetch(`${baseUrl}/openapi.json`);
      expect(res.status).toBe(200);
      const served = (await res.json()) as OpenAPIObject;
      expect(served.openapi).toMatch(/^3\./);
      expect(Object.keys(served.paths)).toContain('/api/v1/healthz');
      expect(Object.keys(served.paths)).toContain('/api/v1/readyz');

      const missing: string[] = [];
      for (const [path, operations] of Object.entries(served.paths)) {
        for (const [method, operation] of Object.entries(operations as Record<string, never>)) {
          const operationId = (operation as { operationId?: string })?.operationId;
          if (typeof operationId !== 'string' || operationId.length === 0) {
            missing.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }
      expect(missing).toEqual([]);
    });

    it('/docs serves the Scalar UI reading /openapi.json', async () => {
      const res = await fetch(`${baseUrl}/docs`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="api-reference"');
      expect(html).toContain('data-url="/openapi.json"');
    });

    it('/metrics is disabled by default (404 problem+json)', async () => {
      const res = await fetch(`${baseUrl}/metrics`);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')?.startsWith('application/problem+json')).toBe(true);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['code']).toBe('NOT_FOUND');
    });

    it('CORS is disabled by default (no allowlist configured)', async () => {
      const res = await fetch(`${baseUrl}/api/v1/healthz`, {
        headers: { origin: 'https://anywhere.example' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('metrics-on + CORS-allowlist boot', () => {
    let app: INestApplication;
    let baseUrl: string;
    let savedMetrics: string | undefined;
    let savedCors: string | undefined;

    beforeAll(async () => {
      installTestEnv();
      savedMetrics = process.env['ARCDROP__METRICS__ENABLED'];
      savedCors = process.env['ARCDROP__CORS__ORIGINS'];
      process.env['ARCDROP__METRICS__ENABLED'] = 'true';
      process.env['ARCDROP__CORS__ORIGINS'] = 'https://good.example';

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

      const config = loadConfig();
      app = moduleRef.createNestApplication({ logger: false });
      setupApp(app, config);
      registerInfrastructureRoutes(app, {
        document: buildOpenApiDocument(app),
        config,
      });
      await app.listen(0);
      baseUrl = await app.getUrl();
    }, 30_000);

    afterAll(async () => {
      await app.close();
      // Restore so later suites in the same process see the default state.
      if (savedMetrics === undefined) delete process.env['ARCDROP__METRICS__ENABLED'];
      else process.env['ARCDROP__METRICS__ENABLED'] = savedMetrics;
      if (savedCors === undefined) delete process.env['ARCDROP__CORS__ORIGINS'];
      else process.env['ARCDROP__CORS__ORIGINS'] = savedCors;
    });

    it('/metrics serves Prometheus text when enabled', async () => {
      const res = await fetch(`${baseUrl}/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/plain');
      const body = await res.text();
      expect(body).toContain('process_cpu_user_seconds_total');
    });

    it('CORS allowlist permits configured origins only', async () => {
      const allowed = await fetch(`${baseUrl}/api/v1/healthz`, {
        headers: { origin: 'https://good.example' },
      });
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://good.example');

      const denied = await fetch(`${baseUrl}/api/v1/healthz`, {
        headers: { origin: 'https://evil.example' },
      });
      expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
