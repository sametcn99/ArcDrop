import { HttpException, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { validate } from 'class-validator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { problemForStatus } from '@api/common/problem-json/problem-codes';
import { UserRateLimitService } from '@api/common/rate-limit/user-rate-limit.service';
import { flatValidationErrors } from '@api/common/validation';
import { AuditService } from '@api/audit/audit.service';
import { BookmarksService } from '@api/bookmarks/bookmarks.service';
import { BulkBookmarksService } from '@api/bookmarks/bulk-bookmarks.service';
import { HighlightsService } from '@api/bookmarks/highlights.service';
import { TagsService } from '@api/bookmarks/tags.service';
import { CollectionsService } from '@api/collections/collections.service';
import { DuplicatesService } from '@api/library-health/duplicates.service';
import { MetadataFetchService } from '@api/metadata/metadata-fetch.service';
import { PortabilityService } from '@api/portability/portability.service';
import { SyncService } from '@api/sync/sync.service';
import { SyncTicketService } from '@api/sync/sync-ticket.service';
import pkg from '../../package.json';
import { toDtoInstances } from './dto-schema';
import { McpSessionRegistry } from './mcp-session.registry';
import { buildToolCatalog, toolInputSchema, type McpToolDefinition } from './mcp-tool-catalog';

interface RequestContext {
  principal: RequestUser;
  requestId?: string;
}

const SERVER_INFO = { name: 'arcdrop', version: pkg.version } as const;

const SERVER_INSTRUCTIONS =
  'ArcDrop — self-hosted bookmark library. One tool per REST operation ' +
  '(tool names are the REST operationIds). All data is user-scoped: you only ' +
  'ever see and mutate the library of the token’s owner. Mutations go through ' +
  'the same change log as every other client, so connected devices converge ' +
  'with your changes via listSyncChanges / the ws push channel. A scope=' +
  'read-only token refuses every mutation tool.';

/**
 * The MCP endpoint brain (plan M7/D23): Streamable HTTP transport at
 * `/api/v1/mcp`, one protocol `Server` per session, the request principal
 * carried through `AsyncLocalStorage` so concurrent tool calls on one
 * session can never cross credentials, every `tools/call` validated with
 * the SAME DTO pipeline as REST, dispatched into the SAME services, and
 * audited (success and failure) into `audit_log_entries`.
 */
@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly registry = new McpSessionRegistry();
  private readonly context = new AsyncLocalStorage<RequestContext>();
  private readonly tools: McpToolDefinition[];

  constructor(
    bookmarks: BookmarksService,
    bulkBookmarks: BulkBookmarksService,
    highlights: HighlightsService,
    tags: TagsService,
    collections: CollectionsService,
    duplicates: DuplicatesService,
    metadata: MetadataFetchService,
    sync: SyncService,
    syncTickets: SyncTicketService,
    portability: PortabilityService,
    private readonly audit: AuditService,
    private readonly rateLimiter: UserRateLimitService,
  ) {
    this.tools = buildToolCatalog({
      bookmarks,
      bulkBookmarks,
      highlights,
      tags,
      collections,
      duplicates,
      metadata,
      sync,
      syncTickets,
      portability,
    });
  }

  /** Entry point of `POST/GET/DELETE /api/v1/mcp` (the controller hands over raw req/res). */
  async handle(req: Request, res: Response): Promise<void> {
    const principal = req.user as RequestUser;
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    const sessionId = req.headers['mcp-session-id'];
    const headerSessionId = Array.isArray(sessionId) ? sessionId[0] : sessionId;

    if (headerSessionId !== undefined) {
      const session = this.registry.get(headerSessionId);
      if (!session || session.principalKey !== principalKey(principal)) {
        // Unknown session — or one bound to a different credential. Both are
        // "not found" (never reveal whose session an id belongs to).
        jsonRpcHttpError(res, 404, -32001, 'Session not found');
        return;
      }
      await this.runWith(principal, requestId, () =>
        session.transport.handleRequest(req, res, req.body),
      );
      return;
    }

    if (isInitializeRequest(req.body)) {
      if (this.registry.atCapacity()) {
        jsonRpcHttpError(res, 503, -32000, 'Too many open sessions, retry later');
        return;
      }
      const server = this.buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (_id) => {
          this.registry.add({
            server,
            transport,
            principalKey: principalKey(principal),
            createdAt: Date.now(),
          });
        },
      });
      transport.onclose = () => this.registry.remove(transport.sessionId);
      await server.connect(transport);
      await this.runWith(principal, requestId, () => transport.handleRequest(req, res, req.body));
      return;
    }

    // Not an initialize and no valid session — the transport spec says the
    // client must re-send the session id it already holds (or initialize).
    jsonRpcHttpError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header required');
  }

  async onModuleDestroy(): Promise<void> {
    await this.registry.closeAll();
  }

  /**
   * Fresh protocol instance per session: the low-level `Server` with the
   * tools capability. `tools/list` serves the catalog (schemas generated
   * from the DTOs); `tools/call` goes through the guarded dispatcher below.
   */
  private buildServer(): Server {
    const server = new Server(SERVER_INFO, {
      capabilities: { tools: {} },
      instructions: SERVER_INSTRUCTIONS,
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: toolInputSchema(tool),
        annotations: {
          readOnlyHint: !tool.mutation,
          idempotentHint: tool.restMethod === 'GET' || tool.restMethod === 'PUT',
        },
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.dispatchToolCall(request.params.name, request.params.arguments),
    );

    return server;
  }

  /**
   * One tool call. Order of checks (each audited): unknown tool → protocol
   * error; read-only refusal → spec-compliant tool error result; argument
   * validation (same DTO pipeline as REST) → protocol error; expensive
   * per-user tool budgets (import/reindex/bulk) + service call → domain failures
   * (404/409/429…) are tool error results, unknown throws are protocol-level
   * internal errors.
   */
  private async dispatchToolCall(
    name: string,
    args: Record<string, unknown> | undefined,
  ): Promise<CallToolResult> {
    const { principal, requestId } = this.context.getStore() as RequestContext;
    const tool = this.tools.find((candidate) => candidate.name === name);

    if (tool === undefined) {
      this.audit.recordToolCall({
        principal,
        tool: name,
        outcome: 'error',
        args,
        reason: 'unknown tool',
        requestId,
      });
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }

    if (tool.mutation && principal.patReadOnly === true) {
      this.audit.recordToolCall({
        principal,
        tool: name,
        outcome: 'error',
        args,
        reason: 'read-only token refused a mutation',
        requestId,
      });
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text:
              `refused: the token is scope=read-only and "${name}" is a mutation ` +
              `(REST ${tool.restMethod}). Re-run with a read-write token or read the data instead.`,
          },
        ],
      };
    }

    const instances = toDtoInstances(tool.dtos, args);
    const validationErrors = flatValidationErrors([...(await validateAll(instances))]);
    if (validationErrors.length > 0) {
      this.audit.recordToolCall({
        principal,
        tool: name,
        outcome: 'error',
        args,
        reason: 'invalid arguments',
        requestId,
      });
      throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for tool ' + name, {
        errors: validationErrors,
      });
    }

    try {
      // Share expensive per-user rate budgets with the REST endpoints so MCP
      // callers cannot bypass import, reindex, or bulk caps.
      if (name === 'importData') {
        this.rateLimiter.assertWithinLimit('import', principal.id);
      } else if (name === 'reindexBookmark') {
        this.rateLimiter.assertWithinLimit('reindex', principal.id);
      } else if (
        name === 'bulkBookmarks' ||
        name === 'mergeCollections' ||
        name === 'sortCollectionsAlphabetical' ||
        name === 'deleteEmptyCollections'
      ) {
        this.rateLimiter.assertWithinLimit('bulk', principal.id);
      }
      const result = await tool.run(principal, instances as object[]);
      this.audit.recordToolCall({ principal, tool: name, outcome: 'ok', args, requestId });
      if (result === undefined) {
        // The REST operation answered 204 — nothing to structure.
        return { content: [{ type: 'text', text: 'ok' }] };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result as Record<string, unknown>,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        this.audit.recordToolCall({
          principal,
          tool: name,
          outcome: 'error',
          args,
          reason: `service refused: ${error.getStatus()}`,
          requestId,
        });
        return this.domainErrorResult(error);
      }
      this.audit.recordToolCall({
        principal,
        tool: name,
        outcome: 'error',
        args,
        reason: 'internal error',
        requestId,
      });
      throw error; // the SDK answers -32603; the request log carries the stack
    }
  }

  /** Domain failures (404/409/…) are tool-level errors, not protocol errors. */
  private domainErrorResult(error: HttpException): CallToolResult {
    const status = error.getStatus();
    const { code, title } = problemForStatus(status);
    let detail: string = error.message;
    const payload = error.getResponse();
    if (typeof payload === 'object' && payload !== null) {
      const message = (payload as Record<string, unknown>)['message'];
      if (typeof message === 'string') detail = message;
      else if (Array.isArray(message)) detail = message.map(String).join('; ');
    }
    return {
      isError: true,
      content: [{ type: 'text', text: `${status} ${title} (${code}): ${detail}` }],
    };
  }

  private runWith<T>(
    principal: RequestUser,
    requestId: string | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    return this.context.run({ principal, requestId }, work);
  }
}

async function validateAll(
  instances: object[],
): Promise<Array<import('class-validator').ValidationError>> {
  const errors: Array<import('class-validator').ValidationError> = [];
  for (const instance of instances) {
    errors.push(...(await validate(instance, { whitelist: true })));
  }
  return errors;
}

function principalKey(principal: RequestUser): string {
  return `${principal.id}:${principal.authKind === 'pat' ? principal.patId : 'jwt'}`;
}

/** HTTP-level JSON-RPC error (session/capacity layer — before any protocol instance). */
function jsonRpcHttpError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}
