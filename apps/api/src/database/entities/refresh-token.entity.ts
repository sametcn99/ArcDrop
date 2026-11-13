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
 * One rotated refresh token (plan D2: opaque, stored hashed, device-labeled).
 *
 * Rotation appends a NEW row in the same `familyId` and revokes the previous
 * one, so a family is the persistent identity of one logged-in device
 * ("session"). Presenting an already-revoked token is reuse: the whole family
 * is revoked (the device is logged out everywhere it used that family).
 */
@Entity({ name: 'refresh_tokens' })
@Index(['familyId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

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

  /** All rotations of one login share this id — it identifies the session. */
  @Column({ type: 'uuid', name: 'family_id' })
  familyId!: string;

  /** Human-readable device hint (client-provided or derived from User-Agent). */
  @Column({ type: 'text', name: 'device_label' })
  deviceLabel!: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  /** Set when the token is rotated away, revoked, or detected as reused. */
  @Column({ type: 'timestamptz', name: 'revoked_at', nullable: true })
  revokedAt!: Date | null;

  /** Updated whenever the token is used to mint a new pair. */
  @Column({ type: 'timestamptz', name: 'last_used_at', nullable: true })
  lastUsedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
