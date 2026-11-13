import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Bookmark } from './bookmark.entity';
import { Tag } from './tag.entity';

/**
 * Bookmark ↔ tag membership (plan M3). The exact tag set of a bookmark is
 * replaced wholesale by `PUT /bookmarks/{id}/tags`; there is no per-membership
 * endpoint. Memberships to pruned/deleted tags die with them (FK cascade).
 */
@Entity({ name: 'bookmark_tags' })
@Index('IX_bookmark_tags_tag', ['tagId'])
export class BookmarkTag {
  @PrimaryColumn({ type: 'uuid', name: 'bookmark_id' })
  @JoinColumn({ name: 'bookmark_id' })
  @ManyToOne(() => Bookmark, { onDelete: 'CASCADE' })
  bookmarkId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'tag_id' })
  @JoinColumn({ name: 'tag_id' })
  @ManyToOne(() => Tag, { onDelete: 'CASCADE' })
  tagId!: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
