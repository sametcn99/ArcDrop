import { ApiProperty } from '@nestjs/swagger';

export class LivenessDto {
  @ApiProperty({ example: 'ok', description: 'Always "ok" while the process is up.' })
  status!: 'ok';

  @ApiProperty({ example: '0.1.0', description: 'API package version.' })
  version!: string;

  @ApiProperty({ example: 120, description: 'Process uptime in seconds.' })
  uptimeSeconds!: number;
}

export class ReadinessDto {
  @ApiProperty({ example: 'ok', description: '"ok" when every check passes.' })
  status!: 'ok';

  @ApiProperty({
    example: { database: 'ok', dataDir: 'ok' },
    description: 'Per-check status map.',
    additionalProperties: { type: 'string' },
  })
  checks!: Record<'database' | 'dataDir', 'ok'>;
}
