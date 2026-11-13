import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@api/auth/decorators/public.decorator';
import { HealthService } from './health.service';
import { LivenessDto, ReadinessDto } from './health.dto';

/**
 * System probes. Mounted under `/api/v1` via URI versioning (default
 * version), so they resolve to `/api/v1/healthz` and `/api/v1/readyz`.
 * Probes are unauthenticated by design — the global JWT guard would
 * otherwise make every load balancer fail us.
 */
@ApiTags('System')
@Public()
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('healthz')
  @ApiOperation({
    operationId: 'getLiveness',
    summary: 'Liveness — the process is running',
    description: 'Process-level check only; never touches the database or filesystem.',
  })
  @ApiOkResponse({ type: LivenessDto })
  getLiveness(): LivenessDto {
    return this.healthService.getLiveness();
  }

  @Get('readyz')
  @ApiOperation({
    operationId: 'getReadiness',
    summary: 'Readiness — database reachable and data dir writable',
    description: 'Runs `SELECT 1` against PostgreSQL and a write/delete probe on the data dir.',
  })
  @ApiOkResponse({ type: ReadinessDto })
  async getReadiness(): Promise<ReadinessDto> {
    return this.healthService.checkReadiness();
  }
}
