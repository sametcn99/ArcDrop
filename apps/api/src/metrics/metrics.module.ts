import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Provides `MetricsService` unconditionally (cheap when disabled — no
 * collectors start). The `/metrics` HTTP route itself is only registered by
 * `registerInfrastructureRoutes` when `ARCDROP__METRICS__ENABLED` is true.
 */
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
