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

/**
 * A user-defined hierarchical collection (plan M4, D5; extended M19 public sharing).
 * A collection is a plain folder-like node: `parentId` self-references
 * `collections.id` and is `null` for roots. Siblings are ordered by `order`
 * (smaller sorts earlier); `PATCH /collections/order` assigns the values
 * explicitly, creates append at `MAX(order) + 1` within the target sibling group.
 *
 * Trash is a PLAIN `deleted_at` column, NOT `@DeleteDateColumn` — the same
 * discipline as `Bookmark` (TypeORM's soft-delete magic would silently
 * append `deleted_at IS NULL` to finds, contradicting the explicit trash
 * scoping this module states in every query). Trash/restore are plain
 * updates; second DELETE hard-deletes trashed rows.
 */
@Entity({ name: 'collections' })
@Index('IX_collections_user_parent', ['userId', 'parentId'])
@Index('IX_collections_user_share', ['userId', 'shareEnabled'])
@Index('UX_collections_share_token', ['shareToken'], {
  unique: true,
  where: '"share_token" IS NOT NULL',
})
export class Collection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  /** Parent collection; `null` for roots. Self-FK with ON DELETE CASCADE. */
  @Column({ type: 'uuid', name: 'parent_id', nullable: true })
  parentId!: string | null;

  @Column({ type: 'text' })
  title!: string;

  /** Free-form client hint (emoji / icon name); never fetched or derived. */
  @Column({ type: 'text', nullable: true })
  icon!: string | null;

  /** Free-form client hint (e.g. a hex color); never validated further. */
  @Column({ type: 'text', nullable: true })
  color!: string | null;

  /**
   * Sibling order (per-user + per-parent group, active rows only), smaller
   * sorts earlier. The column name is quoted `"order"` in SQL (`ORDER` is a
   * reserved word).
   */
  @Column({ type: 'int', name: 'order', default: 0 })
  order!: number;

  /** Whether public unauthenticated sharing + RSS feed are enabled (M19 / D19). */
  @Column({ type: 'boolean', name: 'share_enabled', default: false })
  shareEnabled!: boolean;

  /**
   * Unguessable 192-bit base64url token while shared; cleared on disable so
   * disable + re-enable rotates to a fresh token (M19).
   */
  @Column({ type: 'text', name: 'share_token', nullable: true })
  shareToken!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /**
   * Trash marker (soft delete). Same rationale as `Bookmark.deletedAt`:
   * plain column, explicit scoping everywhere.
   */
  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;

  @JoinColumn({ name: 'parent_id' })
  @ManyToOne(() => Collection, { onDelete: 'CASCADE' })
  parent?: Collection | null;
}
