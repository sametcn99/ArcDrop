import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AuditLogEntry } from '@api/database/entities/audit-log-entry.entity';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';

export interface AuditToolCallInput {
  principal: RequestUser;
  tool: string;
  outcome: 'ok' | 'error';
  args: Record<string, unknown> | undefined;
  reason?: string;
  requestId?: string;
}

/**
 * Minimal audit sink (plan M7) — one row per MCP tool call, success or
 * failure. Fire-and-forget by contract: audit problems are logged and
 * swallowed, never allowed to fail the tool call they are describing. The
 * M9 admin surface will add the read side; the row shape is kept final so
 * that milestone needs no backfill.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  recordToolCall(input: AuditToolCallInput): void {
    const { principal, tool, outcome, args, reason, requestId } = input;
    const row = this.dataSource.getRepository(AuditLogEntry).create({
      userId: principal.id,
      patId: principal.patId ?? null,
      actorType: principal.authKind,
      action: 'mcp.tools.call',
      subject: tool,
      outcome,
      detail: {
        arguments: args ?? {},
        ...(reason !== undefined ? { reason } : {}),
      },
      requestId: requestId ?? null,
    });
    void this.dataSource
      .getRepository(AuditLogEntry)
      .save(row)
      .catch((error: unknown) => {
        this.logger.warn(`audit insert failed for tool "${tool}": ${(error as Error).message}`);
      });
  }
}
