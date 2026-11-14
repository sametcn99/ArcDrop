import { describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { AppConfig } from '@api/config/env.schema';
import { AppConfigService } from '@api/config/app-config.service';
import { HealthService } from './health.service';

function fakeConfigService(config: AppConfig): AppConfigService {
  // Constructing the service directly (no Nest container) — the APP_CONFIG
  // decorator only adds metadata, so plain `new` works for unit tests.
  return new AppConfigService(config);
}

function makeConfig(dataDir: string): AppConfig {
  return {
    database: { url: 'postgres://arcdrop:arcdrop@localhost:5432/arcdrop_test' },
    jwt: { secret: 'unit-test-secret-0123456789abcdef' },
    port: 3000,
    cors: { origins: [] },
    dataDir,
    metrics: { enabled: false },
    metadata: { enabled: false, allowPrivate: false },
    mcp: { patRequestsPerMinute: 300 },
    portability: { importMaxBytes: 26_214_400, importZipMaxBytes: 314_572_800 },
    rateLimit: {
      importPerMinute: 30,
      reindexPerMinute: 30,
      mcpToolsPerMinute: 300,
      bulkPerMinute: 30,
    },
    log: { level: 'fatal' },
  };
}

function makeService(dbOk: boolean, dataDir: string): HealthService {
  const dataSource = {
    query: mock(async () => {
      if (!dbOk) throw new Error('connection refused');
      return [{ '?column?': 1 }];
    }),
  } as unknown as DataSource;
  return new HealthService(dataSource, fakeConfigService(makeConfig(dataDir)));
}

describe('HealthService', () => {
  it('reports liveness with version and uptime', () => {
    const service = makeService(true, tmpdir());
    const liveness = service.getLiveness();
    expect(liveness.status).toBe('ok');
    expect(typeof liveness.version).toBe('string');
    expect(liveness.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('passes readiness when the database answers and the data dir is writable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arcdrop-readyz-'));
    const service = makeService(true, dir);
    const readiness = await service.checkReadiness();
    expect(readiness).toEqual({
      status: 'ok',
      checks: { database: 'ok', dataDir: 'ok' },
    });
    // The write probe cleans up after itself.
    expect(readdirSync(dir)).toEqual([]);
  });

  it('throws ServiceUnavailableException when the database fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arcdrop-readyz-'));
    const service = makeService(false, dir);
    let error: unknown;
    try {
      await service.checkReadiness();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).message).toContain('Database is not ready');
  });

  it('throws ServiceUnavailableException when the data dir is not writable', async () => {
    // A regular FILE used as the data dir — mkdir/writes against it fail on
    // every platform (recursive mkdir would happily create a deep path).
    const filePath = join(mkdtempSync(join(tmpdir(), 'arcdrop-readyz-')), 'occupied');
    writeFileSync(filePath, 'x');
    const service = makeService(true, filePath);
    let error: unknown;
    try {
      await service.checkDataDir();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).message).toContain('not writable');
  });
});
