import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Minimal audit record for MCP tool calls (plan M7) — the insert side of the
 * M9 admin audit-log surface. One row per `tools/call`, success or failure,
 * written fire-and-forget so audit problems never fail the tool call itself.
 *
 * Deliberately NO foreign keys: an audit trail must outlive the actor rows
 * (a deleted user's admin-visible history must not cascade away), so
 * `userId`/`patId` are plain indexed columns.
 */
@Entity({ name: 'audit_log_entries' })
@Index(['userId', 'createdAt'])
export class AuditLogEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Acting user (indexed, no FK — audit rows outlive the actor). */
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  /** The PAT row id when the call authenticated via a personal access token. */
  @Column({ type: 'uuid', name: 'pat_id', nullable: true })
  patId!: string | null;

  /** How the call authenticated: `jwt` (a device session) or `pat` (an agent). */
  @Column({ type: 'text', name: 'actor_type' })
  actorType!: 'jwt' | 'pat';

  /** What happened — v1 always `mcp.tools.call`. */
  @Column({ type: 'text' })
  action!: string;

  /** The thing acted on — the tool name for tool-call rows. */
  @Column({ type: 'text', nullable: true })
  subject!: string | null;

  /** `ok` or `error` — refusals (unknown tool, bad args, read-only) are errors. */
  @Column({ type: 'text' })
  outcome!: 'ok' | 'error';

  /** Tool arguments and the failure reason when `outcome = error`. */
  @Column({ type: 'jsonb', nullable: true })
  detail!: Record<string, unknown> | null;

  /** Correlation id of the HTTP request that carried the tool call. */
  @Column({ type: 'text', name: 'request_id', nullable: true })
  requestId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
