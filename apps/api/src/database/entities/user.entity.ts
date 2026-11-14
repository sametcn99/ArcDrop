import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';

/**
 * A registered instance user (plan D3: roles `admin | user`, status
 * `active | disabled`; first-run bootstrap creates the admin).
 *
 * `passwordHash` is `null` for admin-created users until they claim their
 * invite token (plan D15) — login is impossible before that, by construction.
 */
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Stored normalized lowercase; uniqueness enforced in the database. */
  @Index({ unique: true })
  @Column({ type: 'text' })
  email!: string;

  /** argon2id PHC string; `null` until the invite is claimed (D15). */
  @Column({ type: 'text', name: 'password_hash', nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'enum', enum: ['admin', 'user'], enumName: 'user_role' })
  role!: UserRole;

  @Column({ type: 'enum', enum: ['active', 'disabled'], enumName: 'user_status' })
  status!: UserStatus;

  /**
   * Whether TOTP two-factor authentication is currently enabled (M15).
   * Remains `false` while `totpSecret` holds an unconfirmed setup secret.
   */
  @Column({ type: 'boolean', name: 'totp_enabled', default: false })
  totpEnabled!: boolean;

  /**
   * AES-256-GCM encrypted Base32 TOTP shared secret (M15). Holds either a
   * pending setup secret (`totpEnabled === false`) or the active secret.
   */
  @Column({ type: 'text', name: 'totp_secret', nullable: true })
  totpSecret!: string | null;

  /**
   * Per-user monotonic change-log cursor (plan D4). Incremented atomically
   * (`UPDATE ... RETURNING`) by `ChangeLogService` once per recorded change —
   * the row lock serializes concurrent writers, so a user's seqs are gapless.
   * `bigint` → TypeORM surfaces it as a string; it never participates in
   * arithmetic here.
   */
  @Column({ type: 'bigint', name: 'sync_seq', default: 0 })
  syncSeq!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
