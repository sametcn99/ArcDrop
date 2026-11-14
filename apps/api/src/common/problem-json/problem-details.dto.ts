import { ApiProperty, ApiPropertyOptional, type OpenAPIObject } from '@nestjs/swagger';
import { PROBLEM_BASE_URL, problemForStatus, problemTypeUri } from './problem-codes';

export class ProblemFieldErrorDto {
  @ApiProperty({ example: 'url' })
  field!: string;

  @ApiProperty({ type: [String], example: ['url must be a valid HTTP or HTTPS URL'] })
  messages!: string[];
}

export class ProblemDetailsDto {
  @ApiProperty({ example: `${PROBLEM_BASE_URL}/validation-failed` })
  type!: string;

  @ApiProperty({ example: 'Bad Request' })
  title!: string;

  @ApiProperty({ example: 400 })
  status!: number;

  @ApiProperty({ example: 'VALIDATION_FAILED' })
  code!: string;

  @ApiProperty({ example: 'Validation failed' })
  detail!: string;

  @ApiPropertyOptional({ example: '/api/v1/bookmarks' })
  instance?: string;

  @ApiPropertyOptional({ example: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b' })
  requestId?: string;

  @ApiPropertyOptional({ type: () => [ProblemFieldErrorDto] })
  errors?: ProblemFieldErrorDto[];

  @ApiPropertyOptional({
    description: 'Short-lived 2FA login challenge token (present when `code === "TOTP_REQUIRED"`)',
  })
  challenge?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Challenge expiry timestamp (present when `code === "TOTP_REQUIRED"`)',
  })
  expiresAt?: string;
}

interface ProblemSpec {
  description: string;
  example: Record<string, unknown>;
}

const PROBLEM_SPECS: Readonly<Record<string, ProblemSpec>> = {
  '400': {
    description: 'Malformed request or DTO validation failure (`application/problem+json`)',
    example: {
      type: problemTypeUri('VALIDATION_FAILED'),
      title: 'Bad Request',
      status: 400,
      code: 'VALIDATION_FAILED',
      detail: 'Validation failed',
      instance: '/api/v1/bookmarks',
      requestId: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b',
      errors: [{ field: 'url', messages: ['url must be a URL address'] }],
    },
  },
  '401': {
    description: 'Missing, expired, or invalid credentials (`application/problem+json`)',
    example: {
      type: problemTypeUri(problemForStatus(401).code),
      title: 'Unauthorized',
      status: 401,
      code: 'UNAUTHORIZED',
      detail: 'Missing or invalid bearer token',
      instance: '/api/v1/bookmarks',
      requestId: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b',
    },
  },
  '403': {
    description: 'Insufficient role or personal access token scope (`application/problem+json`)',
    example: {
      type: problemTypeUri(problemForStatus(403).code),
      title: 'Forbidden',
      status: 403,
      code: 'FORBIDDEN',
      detail: 'Read-only personal access tokens cannot perform mutations',
      instance: '/api/v1/bookmarks',
      requestId: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b',
    },
  },
  '404': {
    description: 'Requested resource was not found (`application/problem+json`)',
    example: {
      type: problemTypeUri(problemForStatus(404).code),
      title: 'Not Found',
      status: 404,
      code: 'NOT_FOUND',
      detail: 'Resource not found',
      instance: '/api/v1/bookmarks/00000000-0000-4000-8000-000000000000',
      requestId: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b',
    },
  },
  '409': {
    description:
      'Resource conflict or concurrent operation in progress (`application/problem+json`)',
    example: {
      type: problemTypeUri(problemForStatus(409).code),
      title: 'Conflict',
      status: 409,
      code: 'CONFLICT',
      detail: 'Resource already exists or cannot transition in its current state',
      instance: '/api/v1/data/import',
      requestId: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b',
    },
  },
  '413': {
    description: 'Request payload exceeds configured size limit (`application/problem+json`)',
    example: {
      type: problemTypeUri(problemForStatus(413).code),
      title: 'Payload Too Large',
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      detail: 'JSON request body exceeds the configured size limit',
      instance: '/api/v1/bookmarks',
      requestId: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b',
    },
  },
  '429': {
    description: 'Rate limit exceeded (`application/problem+json`)',
    example: {
      type: problemTypeUri(problemForStatus(429).code),
      title: 'Too Many Requests',
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      detail: 'Rate limit exceeded — try again shortly',
      instance: '/api/v1/auth/login',
      requestId: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b',
    },
  },
  '500': {
    description: 'Unexpected internal server error (`application/problem+json`)',
    example: {
      type: problemTypeUri(problemForStatus(500).code),
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred.',
      instance: '/api/v1/bookmarks',
      requestId: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b',
    },
  },
  '503': {
    description: 'Readiness check dependency failure (`application/problem+json`)',
    example: {
      type: problemTypeUri(problemForStatus(503).code),
      title: 'Service Unavailable',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      detail: 'Database readiness check failed',
      instance: '/api/v1/readyz',
      requestId: '8c5b6d8d-8e62-4e79-9b34-1c2d3e4f5a6b',
    },
  },
};

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'search',
  'trace',
]);

function buildProblemResponseObject(status: string, spec: ProblemSpec) {
  return {
    description: spec.description,
    content: {
      'application/problem+json': {
        schema: { $ref: '#/components/schemas/ProblemDetailsDto' },
        example: spec.example,
      },
    },
  };
}

/**
 * Enriches the generated OpenAPI document with reusable RFC 7807
 * `application/problem+json` response objects and concrete error examples on
 * every route.
 */
export function enrichOpenApiWithProblemResponses(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.responses ??= {};

  for (const [status, spec] of Object.entries(PROBLEM_SPECS)) {
    document.components.responses[`Problem${status}`] = buildProblemResponseObject(status, spec);
  }

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (!rawOperation || typeof rawOperation !== 'object' || Array.isArray(rawOperation)) {
        continue;
      }
      const operation = rawOperation as {
        operationId?: string;
        security?: Array<Record<string, string[]>>;
        responses?: Record<string, Record<string, unknown>>;
      };
      operation.responses ??= {};

      const isBearerSecured =
        Array.isArray(operation.security) &&
        operation.security.some((entry) => Object.keys(entry).includes('bearer'));
      const isMcp = path.endsWith('/mcp');
      const hasJsonOrBody =
        method === 'post' || method === 'put' || method === 'patch' || path === '/api/v1/me';

      const attachIfMissing = (status: string): void => {
        const spec = PROBLEM_SPECS[status];
        if (!spec) return;
        const existing = operation.responses![status];
        if (!existing) {
          operation.responses![status] = buildProblemResponseObject(status, spec);
          return;
        }
        if (!existing['content']) {
          existing['content'] = buildProblemResponseObject(status, spec).content;
        }
      };

      // Cross-cutting error responses enforced by global guards/filters:
      if (hasJsonOrBody) {
        attachIfMissing('400');
        attachIfMissing('413');
      } else if (
        method === 'get' &&
        (path.includes('/audit') || path.includes('/bookmarks') || path.includes('/sync/changes'))
      ) {
        attachIfMissing('400');
      }

      if (isBearerSecured) {
        attachIfMissing('401');
        if (!isMcp) {
          attachIfMissing('403');
        }
      }

      if (path.includes('{')) {
        attachIfMissing('404');
      }

      if (
        path.endsWith('/auth/bootstrap') ||
        path.endsWith('/auth/tfa/setup') ||
        path.endsWith('/auth/tfa/enable') ||
        path.endsWith('/admin/users') ||
        path.endsWith('/data/import') ||
        path.endsWith('/tags/rename') ||
        path.endsWith('/collections') ||
        path.endsWith('/bookmarks') ||
        path === '/api/v1/me'
      ) {
        if (method === 'post' || method === 'delete' || method === 'patch') {
          attachIfMissing('409');
        }
      }

      if (path.endsWith('/readyz')) {
        attachIfMissing('503');
      }

      attachIfMissing('429');
      attachIfMissing('500');
    }
  }

  return document;
}
