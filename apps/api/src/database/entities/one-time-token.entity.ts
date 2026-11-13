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

export type OneTimeTokenType = 'invite' | 'reset';

/**
 * A single-use, expiring token handed back through the admin API response
 * (plan D15 — no SMTP in v1): `invite` tokens (~24h) set a first password,
 * `reset` tokens (~1h) replace a lost one. `POST /auth/claim` consumes them.
 *
 * Stored hashed; `usedAt` marks consumption — a used or expired token is
 * rejected, which makes the token single-use by construction.
 */
@Entity({ name: 'one_time_tokens' })
export class OneTimeToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: ['invite', 'reset'], enumName: 'one_time_token_type' })
  type!: OneTimeTokenType;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** sha256 of the opaque token — the raw token never touches the database. */
  @Index({ unique: true })
  @Column({ type: 'text', name: 'token_hash' })
  tokenHash!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  /** Set on consumption; a token with `usedAt` is dead. */
  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
