import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Bookmark } from './bookmark.entity';
import { Collection } from './collection.entity';

/**
 * Bookmark ↔ collection membership (plan D5: many-to-many — a bookmark can
 * live in several collections; plan D21 / M16: manual order lives on this
 * membership edge so the same bookmark holds independent positions across
 * collections). The TABLE landed in M3; M4 added the collections table plus
 * this side's foreign key (`ON DELETE CASCADE`) and activated the endpoints
 * that read/write it.
 */
@Entity({ name: 'bookmark_collections' })
@Index('IX_bookmark_collections_collection', ['collectionId'])
@Index('IX_bookmark_collections_collection_order', ['collectionId', 'order'])
export class BookmarkCollection {
  @PrimaryColumn({ type: 'uuid', name: 'bookmark_id' })
  @JoinColumn({ name: 'bookmark_id' })
  @ManyToOne(() => Bookmark, { onDelete: 'CASCADE' })
  bookmarkId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'collection_id' })
  @JoinColumn({ name: 'collection_id' })
  @ManyToOne(() => Collection, { onDelete: 'CASCADE' })
  collectionId!: string;

  /**
   * Membership-scoped manual position (plan D21, M16): smaller sorts earlier.
   * Existing rows default to `0` at migration time so newly appended items
   * (`MAX(order) + 1`) follow pre-existing items; nullable so `NULL` rows
   * cleanly sort `NULLS LAST` under `sort=manual`.
   */
  @Column({ type: 'int', name: 'order', nullable: true, default: 0 })
  order!: number | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
