import { describe, expect, it, mock } from 'bun:test';
import { BadRequestException, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ProblemJsonFilter } from './problem-json.filter';
import type { ProblemDetails } from './problem-codes';

interface Capture {
  statusCode?: number;
  contentType?: string;
  body?: ProblemDetails;
}

function createHost(requestUrl: string, requestId?: string, headersSent = false) {
  const capture: Capture = {};
  const request = {
    method: 'GET',
    url: requestUrl,
    originalUrl: requestUrl,
    id: requestId,
  } as unknown as Request & { id?: string };

  const response = {
    headersSent,
    setHeader: mock((name: string, value: string) => {
      if (name.toLowerCase() === 'content-type') capture.contentType = value;
    }),
    status: mock(function status(code: number) {
      capture.statusCode = code;
      return response as unknown as Response;
    }),
    json: mock((body: ProblemDetails) => {
      capture.body = body;
      return response as unknown as Response;
    }),
  };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { filter: new ProblemJsonFilter(), host, capture };
}

describe('ProblemJsonFilter', () => {
  it('maps HttpException to problem+json with a stable code', () => {
    const { filter, host, capture } = createHost('/api/v1/missing', 'req-42');
    filter.catch(new NotFoundException(), host);

    expect(capture.statusCode).toBe(404);
    expect(capture.contentType).toBe('application/problem+json; charset=utf-8');
    const body = capture.body!;
    expect(body.code).toBe('NOT_FOUND');
    expect(body.title).toBe('Not Found');
    expect(body.status).toBe(404);
    expect(body.type).toBe('https://arcdrop.dev/problems/not-found');
    expect(body.detail).toBe('Not Found');
    expect(body.instance).toBe('/api/v1/missing');
    expect(body.requestId).toBe('req-42');
  });

  it('maps unknown throws to 500 INTERNAL_ERROR without leaking internals', () => {
    const { filter, host, capture } = createHost('/api/v1/anything', 'req-7');
    filter.catch(new Error('db password is hunter2'), host);

    expect(capture.statusCode).toBe(500);
    const body = capture.body!;
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.detail).toBe('An unexpected error occurred.');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('passes validation field details through as VALIDATION_FAILED', () => {
    const { filter, host, capture } = createHost('/api/v1/echo', 'req-9');
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: 'Validation failed',
        errors: [{ field: 'name', messages: ['name must be a string'] }],
      }),
      host,
    );

    expect(capture.statusCode).toBe(400);
    const body = capture.body!;
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors).toEqual([{ field: 'name', messages: ['name must be a string'] }]);
  });

  it('does nothing when headers are already sent', () => {
    const { filter, host, capture } = createHost('/api/v1/stream', undefined, true);
    filter.catch(new NotFoundException(), host);
    expect(capture.statusCode).toBeUndefined();
    expect(capture.body).toBeUndefined();
  });
});
