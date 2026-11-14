import { All, Controller, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PatScopeDeferred } from '@api/auth/decorators/pat-scope-deferred.decorator';
import { McpService } from './mcp.service';

/**
 * MCP Streamable HTTP endpoint (plan M7/D23) — `/api/v1/mcp`.
 *
 * Bearer-authenticated like every other route (access JWT or personal
 * access token; the global guard chain runs — `@Public()` is NOT set).
 * `@PatScopeDeferred()` moves the read-only enforcement from the HTTP
 * method (every tool call is a POST) to the MCP layer, which refuses each
 * mutation TOOL individually with a spec-compliant tool error. The same
 * deferral exempts the endpoint from nothing else — `/auth` and `/admin`
 * rules never apply here (this controller is neither), and the per-PAT
 * rate budget still counts every request.
 *
 * The handler hands the raw Express request/response pair to the SDK's
 * `StreamableHTTPServerTransport` — the endpoint speaks JSON-RPC, not
 * problem+json (the protocol surface defines its own error shapes; the
 * REST problem+json contract applies to REST routes).
 */
@ApiTags('MCP')
@ApiBearerAuth()
@PatScopeDeferred()
@Controller('mcp')
export class McpController {
  constructor(private readonly mcp: McpService) {}

  @All()
  @ApiOperation({
    operationId: 'mcpStreamableHttp',
    summary:
      'MCP Streamable HTTP endpoint (initialize · tools/list · tools/call; session via Mcp-Session-Id)',
    description:
      'JSON-RPC over HTTP POST with optional SSE stream, per the MCP ' +
      'Streamable HTTP transport. Initialize without a session id; every ' +
      'later request carries the returned Mcp-Session-Id header; DELETE ' +
      'closes the session. GET opens the server-push SSE stream. The caller ' +
      'must be bearer-authenticated (access JWT or personal access token); ' +
      'a session is bound to the credential that created it.',
  })
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.mcp.handle(req, res);
  }
}
