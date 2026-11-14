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

export type OneTimeTokenType = 'invite' | 'reset' | 'tfa_challenge';

/**
 * A single-use, expiring token:
 * - `invite` (~24h) sets a first password via `POST /auth/claim` (D15)
 * - `reset` (~1h) replaces a lost password via `POST /auth/claim` (D15)
 * - `tfa_challenge` (~5m) bridges step 1 (`POST /auth/login` → 401 `TOTP_REQUIRED`)
 *   and step 2 (`POST /auth/login/tfa`) when 2FA is enabled (M15).
 *
 * Stored hashed; `usedAt` marks consumption — a used or expired token is
 * rejected, which makes the token single-use by construction.
 */
@Entity({ name: 'one_time_tokens' })
export class OneTimeToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: ['invite', 'reset', 'tfa_challenge'],
    enumName: 'one_time_token_type',
  })
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
