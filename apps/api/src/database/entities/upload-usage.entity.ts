import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Per-user monthly upload byte counter (plan M18 / D19, Raindrop parity G17).
 *
 * Keyed by `(userId, month)` where `month` is a UTC calendar bucket `'YYYY-MM'`.
 * Rolls over automatically when the UTC month changes (a fresh month reads 0
 * bytes used and creates a new row on the first upload). Foreign key cascades on
 * user deletion (`ON DELETE CASCADE`), while `POST /me/reset-data` preserves
 * quota usage for the current month.
 */
@Entity({ name: 'upload_usage' })
@Index('UX_upload_usage_user_month', ['userId', 'month'], { unique: true })
export class UploadUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** UTC calendar month bucket (`YYYY-MM`). */
  @Column({ type: 'varchar', length: 7 })
  month!: string;

  /** Cumulative uploaded bytes in this month (`bigint` stored as string). */
  @Column({ type: 'bigint', name: 'bytes_used', default: 0 })
  bytesUsed!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
