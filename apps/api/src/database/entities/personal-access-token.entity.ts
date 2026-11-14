import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Personal access token (plan M7/D23) — the auth path for agents and other
 * clients that cannot run the refresh-token flow: long-lived, labeled,
 * revocable, hashed at rest. A PAT authenticates as its owner (the same
 * user-scoped services run), with two restrictions enforced by
 * `PatScopeGuard`: the `/auth/*` and `/admin/*` surfaces are unreachable,
 * and `readOnly` tokens may only call safe (GET) REST routes — mutation
 * MCP tools are refused per-tool by the MCP layer.
 *
 * The raw token is shown exactly once in the create response; only its
 * sha256 is stored (same discipline as refresh tokens). Revocation is a
 * `revoked_at` stamp — rows are kept (audit value), never deleted, and a
 * revoked token is a 401 forever after.
 */
@Entity({ name: 'personal_access_tokens' })
@Index(['userId'])
export class PersonalAccessToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** sha256 hex of the raw token — the raw value never touches the database. */
  @Index({ unique: true })
  @Column({ type: 'text', name: 'token_hash' })
  tokenHash!: string;

  /** Human label chosen at creation ("Claude Desktop", "CI export job", …). */
  @Column({ type: 'text' })
  name!: string;

  /** `scope: read-only` — blocks mutations at the guard / MCP-tool level. */
  @Column({ type: 'boolean', name: 'read_only', default: false })
  readOnly!: boolean;

  /** Last request this token authenticated (best-effort, fire-and-forget). */
  @Column({ type: 'timestamptz', name: 'last_used_at', nullable: true })
  lastUsedAt!: Date | null;

  /** Set when the token is revoked — revoked tokens authenticate never again. */
  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
