import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Bookmark } from './bookmark.entity';
import { User } from './user.entity';

export const NOTIFICATION_TYPES = ['reminder'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface ReminderNotificationPayload {
  bookmarkId: string;
  title: string | null;
  url: string;
  reminderAt: string;
}

/**
 * Durable notification outbox row (plan M14 / D20).
 *
 * Written in the same transaction as `Bookmark.remindedAt` when a due reminder
 * fires, so offline devices can catch up via `GET /notifications` while online
 * devices receive the live websocket push post-commit.
 */
@Entity({ name: 'notification_outbox' })
@Index('IX_notification_outbox_user_created', ['userId', 'createdAt'])
@Index('IX_notification_outbox_user_read_created', ['userId', 'readAt', 'createdAt'])
export class NotificationOutbox {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  @JoinColumn({ name: 'user_id' })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  userId!: string;

  @Column({
    type: 'enum',
    enum: NOTIFICATION_TYPES,
    enumName: 'notification_type',
    default: 'reminder',
  })
  type!: NotificationType;

  /**
   * Referenced bookmark id. `ON DELETE SET NULL` keeps inbox history intact
   * even if the bookmark is later purged from the trash; `payload` retains
   * the snapshot metadata (`bookmarkId`, `title`, `url`, `reminderAt`).
   */
  @Column({ type: 'uuid', name: 'bookmark_id', nullable: true })
  @JoinColumn({ name: 'bookmark_id' })
  @ManyToOne(() => Bookmark, { onDelete: 'SET NULL', nullable: true })
  bookmarkId!: string | null;

  @Column({ type: 'jsonb' })
  payload!: ReminderNotificationPayload;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'read_at', nullable: true })
  readAt!: Date | null;
}
