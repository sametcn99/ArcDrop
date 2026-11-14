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
 * Single-use TOTP recovery codes (M15). Generated when a user enables 2FA,
 * returned once in plaintext, and stored as sha256 hashes. Consuming a code
 * atomically stamps `usedAt` so each code can only be used once.
 */
@Entity({ name: 'tfa_recovery_codes' })
@Index('IX_tfa_recovery_codes_user_hash', ['userId', 'codeHash'], { unique: true })
export class TfaRecoveryCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('IX_tfa_recovery_codes_user')
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** sha256 hex of the normalized recovery code. */
  @Column({ type: 'text', name: 'code_hash' })
  codeHash!: string;

  @Column({ type: 'timestamptz', name: 'used_at', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
