import { Module } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '@api/config/app-config.service';
import pkg from '../../package.json';

/**
 * Request correlation: honor an incoming `x-request-id` (from a proxy or a
 * client retry), otherwise mint a UUID. The id is echoed on the response and
 * attached to every request log line and every problem+json body.
 */
function requestCorrelationId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const header = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = typeof header === 'string' && header.trim().length > 0 ? header.trim() : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,
          base: { app: 'arcdrop-api', version: pkg.version },
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie'],
            censor: '[REDACTED]',
          },
          genReqId: requestCorrelationId,
          // Probes and scrapes poll constantly — keep them out of the logs.
          autoLogging: {
            ignore: (req) => {
              const url = req.url ?? '';
              return (
                url.startsWith('/metrics') ||
                url.includes('/healthz') ||
                url.includes('/readyz') ||
                url.startsWith('/openapi.json') ||
                url.startsWith('/docs')
              );
            },
          },
        },
      }),
    }),
  ],
})
export class LoggingModule {}
