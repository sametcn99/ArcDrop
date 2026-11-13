import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfigService } from '@api/config/app-config.service';
import pkg from '../../package.json';
import type { LivenessDto, ReadinessDto } from './health.dto';
/**
 * Process-level liveness and full readiness (DB + data dir).
 * `checkReadiness` throws `ServiceUnavailableException` naming the failed
 * check; the global filter renders it as problem+json with code
 * SERVICE_UNAVAILABLE.
 */
@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AppConfigService) private readonly appConfig: AppConfigService,
  ) {}

  getLiveness(): LivenessDto {
    return {
      status: 'ok',
      version: pkg.version,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async checkDatabase(): Promise<void> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      throw new ServiceUnavailableException(`Database is not ready: ${(error as Error).message}`);
    }
  }

  async checkDataDir(): Promise<void> {
    const dir = this.appConfig.dataDir;
    const probe = join(dir, `.readyz-${process.pid}-${Date.now()}`);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(probe, 'ok', { flag: 'wx' });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Data directory "${dir}" is not writable: ${(error as Error).message}`,
      );
    } finally {
      // Best-effort cleanup — never mask (or escape) the readiness verdict.
      await rm(probe, { force: true, recursive: true }).catch(() => undefined);
    }
  }

  async checkReadiness(): Promise<ReadinessDto> {
    await this.checkDatabase();
    await this.checkDataDir();
    return { status: 'ok', checks: { database: 'ok', dataDir: 'ok' } };
  }
}
