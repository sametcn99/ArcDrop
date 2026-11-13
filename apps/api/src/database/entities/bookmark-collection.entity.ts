import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Bookmark } from './bookmark.entity';

/**
 * Bookmark ↔ collection membership (plan D5: many-to-many — a bookmark can
 * live in several collections). The TABLE lands in M3; the collections table
 * and its endpoints arrive in M4, so `collectionId` carries NO foreign key
 * yet — M4's migration must add:
 *
 *   ALTER TABLE bookmark_collections
 *     ADD CONSTRAINT FK_... FOREIGN KEY (collection_id)
 *     REFERENCES collections(id) ON DELETE CASCADE;
 *
 * Nothing writes memberships before M4; `unassignedOnly` in the M3 list
 * query already reads this table, so the filter is live the day collections
 * exist.
 */
@Entity({ name: 'bookmark_collections' })
@Index('IX_bookmark_collections_collection', ['collectionId'])
export class BookmarkCollection {
  @PrimaryColumn({ type: 'uuid', name: 'bookmark_id' })
  @JoinColumn({ name: 'bookmark_id' })
  @ManyToOne(() => Bookmark, { onDelete: 'CASCADE' })
  bookmarkId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'collection_id' })
  collectionId!: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
