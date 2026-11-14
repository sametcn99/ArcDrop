import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

/**
 * One live MCP client session: one `Server` (protocol instance) pinned to
 * one `StreamableHTTPServerTransport`. Created by the `initialize` request,
 * keyed by the generated `Mcp-Session-Id`, bound to the principal that
 * created it — later requests must present the same bearer credential
 * (same user AND same token); anything else is a 404, exactly like an
 * unknown session.
 *
 * In-memory by design (v1 is single-instance, same posture as the ws
 * ticket store and the per-PAT rate window): a restart costs every client
 * one re-initialize. Sessions die on the client's `DELETE`, on transport
 * close, or when the process stops.
 */
export interface McpSession {
  readonly server: Server;
  readonly transport: StreamableHTTPServerTransport;
  /** `userId:patId-or-jwt` — the credential this session was created with. */
  readonly principalKey: string;
  readonly createdAt: number;
}

export const MAX_MCP_SESSIONS = 1000;

export class McpSessionRegistry {
  private readonly sessions = new Map<string, McpSession>();

  get size(): number {
    return this.sessions.size;
  }

  atCapacity(): boolean {
    return this.sessions.size >= MAX_MCP_SESSIONS;
  }

  add(session: McpSession): void {
    if (session.transport.sessionId === undefined) {
      throw new Error('cannot register a session without a session id');
    }
    this.sessions.set(session.transport.sessionId, session);
  }

  get(sessionId: string): McpSession | undefined {
    return this.sessions.get(sessionId);
  }

  remove(sessionId: string | undefined): void {
    if (sessionId !== undefined) this.sessions.delete(sessionId);
  }

  /** On shutdown: close every transport so SSE streams end and pending requests reject. */
  async closeAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of all) {
      await session.transport.close().catch(() => {
        // best effort — shutdown must not hang on a dead stream
      });
    }
  }
}
