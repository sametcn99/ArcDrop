import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { problemForStatus, problemTypeUri } from './problem-codes';
import type { ProblemDetails } from './problem-codes';

interface MappedProblem {
  status: number;
  title: string;
  code: string;
  detail: string;
  errors?: Array<{ field: string; messages: string[] }>;
}

/**
 * Global exception filter: every error — known `HttpException` or unknown
 * throw — leaves the API as RFC 7807 `application/problem+json` with a
 * machine-readable `code` (plan D9). 5xx are logged with the request's
 * correlation id; 4xx responses are already captured by request logging.
 */
@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemJsonFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: unknown }>();

    if (response.headersSent) return;

    const mapped = this.map(exception, request);
    const problem: ProblemDetails = {
      type: problemTypeUri(mapped.code),
      title: mapped.title,
      status: mapped.status,
      code: mapped.code,
      detail: mapped.detail,
      instance: request.originalUrl ?? request.url,
      requestId: typeof request.id === 'string' ? request.id : undefined,
      ...(mapped.errors ? { errors: mapped.errors } : {}),
    };

    if (mapped.status >= 500) {
      const error = exception instanceof Error ? exception : undefined;
      this.logger.error(
        `Unhandled error on ${request.method} ${request.originalUrl ?? request.url}: ${mapped.detail}`,
        error?.stack,
      );
    }

    // Explicit charset keeps the header deterministic — Express would
    // otherwise append its own; clients match on the base media type.
    response.setHeader('Content-Type', 'application/problem+json; charset=utf-8');
    response.status(mapped.status).json(problem);
  }

  private map(exception: unknown, request: Request): MappedProblem {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const { code, title } = problemForStatus(status);
      let detail = exception.message;
      let errors: MappedProblem['errors'];

      const payload = exception.getResponse();
      if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        if (typeof record['message'] === 'string') {
          detail = record['message'];
        } else if (Array.isArray(record['message'])) {
          detail = record['message'].map(String).join('; ');
        }
        if (Array.isArray(record['errors'])) {
          errors = record['errors'] as Array<{ field: string; messages: string[] }>;
        }
      }

      return {
        status,
        title,
        // Validation payloads carry field details — give them a precise code.
        code: errors ? 'VALIDATION_FAILED' : code,
        detail: detail || `${title} (${request.method} ${request.url})`,
        errors,
      };
    }

    // Unknown throw: never leak internals to the client; the stack is logged
    // above with the correlation id.
    return {
      status: 500,
      title: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred.',
    };
  }
}
