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
 * A user-defined hierarchical collection (plan M4, D5). A collection is a
 * plain folder-like node: `parentId` self-references `collections.id` and is
 * `null` for roots. Siblings are ordered by `order` (smaller sorts earlier);
 * `PATCH /collections/order` assigns the values explicitly, creates append
 * at `MAX(order) + 1` within the target sibling group.
 *
 * Trash is a PLAIN `deleted_at` column, NOT `@DeleteDateColumn` — the same
 * discipline as `Bookmark` (TypeORM's soft-delete magic would silently
 * append `deleted_at IS NULL` to finds, contradicting the explicit trash
 * scoping this module states in every query). Trash/restore are plain
 * updates; there is no hard-delete path in the API for collections.
 */
@Entity({ name: 'collections' })
@Index('IX_collections_user_parent', ['userId', 'parentId'])
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
