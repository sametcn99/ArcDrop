import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A per-user tag (plan M3). Tag names are unique PER USER case-insensitively:
 * `name` keeps the display case of the first creation, `nameLower` is the
 * normalization key behind the `(userId, nameLower)` unique index — `Work`
 * and `work` collapse to one tag, whichever was created first wins the case.
 *
 * Invariant: a tag row exists only while at least one membership references
 * it — operations that detach the last membership prune the tag (documented
 * in the README's M3 section).
 */
@Entity({ name: 'tags' })
@Index('UX_tags_user_name_lower', ['userId', 'nameLower'], { unique: true })
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  /** Display name as first created (trimmed, original case). */
  @Column({ type: 'text' })
  name!: string;

  /** `name.toLowerCase()` — uniqueness key and case-insensitive lookups. */
  @Column({ type: 'text', name: 'name_lower' })
  nameLower!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
