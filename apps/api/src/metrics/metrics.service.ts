import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { AppConfigService } from '@api/config/app-config.service';

/**
 * Prometheus registry for the optional `/metrics` endpoint (config flag
 * `ARCDROP__METRICS__ENABLED`, default off). A per-instance `Registry` keeps
 * concurrent test boots isolated. Default metrics are scrape-time collectors
 * (prom-client 15.x, Bun-aware) — no background timers to manage.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  constructor(appConfig: AppConfigService) {
    if (appConfig.metricsEnabled) {
      collectDefaultMetrics({ register: this.registry });
    }
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
