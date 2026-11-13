import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Bookmark } from './bookmark.entity';
import { Collection } from './collection.entity';

/**
 * Bookmark ↔ collection membership (plan D5: many-to-many — a bookmark can
 * live in several collections). The TABLE landed in M3; M4 added the
 * collections table plus this side's foreign key (`ON DELETE CASCADE`) and
 * activated the endpoints that read/write it.
 */
@Entity({ name: 'bookmark_collections' })
@Index('IX_bookmark_collections_collection', ['collectionId'])
export class BookmarkCollection {
  @PrimaryColumn({ type: 'uuid', name: 'bookmark_id' })
  @JoinColumn({ name: 'bookmark_id' })
  @ManyToOne(() => Bookmark, { onDelete: 'CASCADE' })
  bookmarkId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'collection_id' })
  @JoinColumn({ name: 'collection_id' })
  @ManyToOne(() => Collection, { onDelete: 'CASCADE' })
  collectionId!: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
