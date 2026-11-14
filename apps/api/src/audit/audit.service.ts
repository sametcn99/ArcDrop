import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AuditLogEntry } from '@api/database/entities/audit-log-entry.entity';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import {
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_MAX_PAGE_SIZE,
  type AuditLogEntryDto,
  type AuditLogListDto,
  type ListAuditLogsQueryDto,
} from './audit.dto';

export interface AuditToolCallInput {
  principal: RequestUser;
  tool: string;
  outcome: 'ok' | 'error';
  args: Record<string, unknown> | undefined;
  reason?: string;
  requestId?: string;
}

export interface AuditAdminActionInput {
  actor: RequestUser;
  action: string;
  subject: string | null;
  outcome: 'ok' | 'error';
  detail?: Record<string, unknown>;
  requestId?: string;
}

/**
 * Audit sink + admin read surface (plan M7 write side, M9 admin actions +
 * read side). Tool-call writes are fire-and-forget so audit problems never
 * fail the tool call; admin action writes are awaited (with internal error
 * catching) so a subsequent `/admin/audit` read immediately observes them.
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

  async recordAdminAction(input: AuditAdminActionInput): Promise<void> {
    const { actor, action, subject, outcome, detail, requestId } = input;
    const row = this.dataSource.getRepository(AuditLogEntry).create({
      userId: actor.id,
      patId: actor.patId ?? null,
      actorType: actor.authKind,
      action,
      subject,
      outcome,
      detail: detail ?? null,
      requestId: requestId ?? null,
    });
    try {
      await this.dataSource.getRepository(AuditLogEntry).save(row);
    } catch (error: unknown) {
      this.logger.warn(`audit insert failed for action "${action}": ${(error as Error).message}`);
    }
  }

  async list(query: ListAuditLogsQueryDto): Promise<AuditLogListDto> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? AUDIT_DEFAULT_PAGE_SIZE, AUDIT_MAX_PAGE_SIZE);

    const qb = this.dataSource
      .getRepository(AuditLogEntry)
      .createQueryBuilder('entry')
      .orderBy('entry.createdAt', 'DESC')
      .addOrderBy('entry.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (query.action !== undefined) {
      qb.andWhere('entry.action = :action', { action: query.action });
    }
    if (query.actorUserId !== undefined) {
      qb.andWhere('entry.userId = :actorUserId', { actorUserId: query.actorUserId });
    }
    if (query.actorType !== undefined) {
      qb.andWhere('entry.actorType = :actorType', { actorType: query.actorType });
    }
    if (query.outcome !== undefined) {
      qb.andWhere('entry.outcome = :outcome', { outcome: query.outcome });
    }
    if (query.subject !== undefined) {
      qb.andWhere('entry.subject = :subject', { subject: query.subject });
    }
    if (query.since !== undefined) {
      qb.andWhere('entry.createdAt >= :since', { since: new Date(query.since) });
    }
    if (query.until !== undefined) {
      qb.andWhere('entry.createdAt <= :until', { until: new Date(query.until) });
    }

    const [rows, totalCount] = await qb.getManyAndCount();
    return {
      items: rows.map(toAuditLogEntryDto),
      totalCount,
      page,
      pageSize,
    };
  }
}

function toAuditLogEntryDto(row: AuditLogEntry): AuditLogEntryDto {
  return {
    id: row.id,
    userId: row.userId,
    patId: row.patId,
    actorType: row.actorType,
    action: row.action,
    subject: row.subject,
    outcome: row.outcome,
    detail: row.detail,
    requestId: row.requestId,
    createdAt: row.createdAt,
  };
}
