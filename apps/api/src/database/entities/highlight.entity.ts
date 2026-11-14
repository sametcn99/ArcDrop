import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Bookmark } from './bookmark.entity';
import { User } from './user.entity';

/**
 * A text highlight on a bookmark (plan D6, M10).
 *
 * Scoped to its owning user (denormalized `userId` alongside `bookmarkId` for
 * direct indexed sync/CRUD queries) and cascades on bookmark hard-delete /
 * trash purge (`ON DELETE CASCADE`). Trashing the parent bookmark leaves its
 * highlights untouched; restoring brings them back.
 */
@Entity({ name: 'highlights' })
@Index('IX_highlights_bookmark_created', ['bookmarkId', 'createdAt'])
@Index('IX_highlights_user', ['userId'])
export class Highlight {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'bookmark_id' })
  @JoinColumn({ name: 'bookmark_id' })
  @ManyToOne(() => Bookmark, { onDelete: 'CASCADE' })
  bookmarkId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  @JoinColumn({ name: 'user_id' })
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  userId!: string;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'text', nullable: true })
  color!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
