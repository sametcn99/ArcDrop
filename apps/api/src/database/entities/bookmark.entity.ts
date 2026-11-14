import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Detected/classified content type for a bookmark (plan M10, Raindrop parity G7).
 * Defaults to `'link'` until classified by the M6/M10 metadata pipeline.
 */
export const CONTENT_TYPES = [
  'article',
  'image',
  'video',
  'audio',
  'document',
  'book',
  'link',
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * The seven derived URL parts (plan D12). `domain` is the Public Suffix List
 * registrable domain (lowercased); `host` is the hostname WITHOUT port; the
 * port/query/fragment columns are `null` when absent. `null` fields are real
 * SQL NULLs so they index and filter cleanly.
 */
export interface UrlParts {
  scheme: string;
  host: string;
  domain: string | null;
  port: string | null;
  path: string;
  query: string | null;
  fragment: string | null;
}

/**
 * A user's bookmark (plan M3, D12/D13; enriched M10).
 *
 * - `url` is stored VERBATIM — never rewritten, never client-writable derived
 *   columns. The `urlParts` columns are derived on every url write via
 *   WHATWG URL parsing + `tldts` registrable-domain lookup (D12).
 * - NO unique index on `(userId, url)` — duplicates are allowed by design
 *   (D13): saving the same URL twice creates two bookmarks.
 * - Trash is a soft delete (`deletedAt`); a scheduled job hard-deletes rows
 *   past the retention setting (D17).
 */
@Entity({ name: 'bookmarks' })
@Index('IX_bookmarks_user_domain', ['userId', 'domain'])
@Index('IX_bookmarks_user_host', ['userId', 'host'])
@Index('IX_bookmarks_user_favorite', ['userId', 'favorite'])
@Index('IX_bookmarks_user_content_type', ['userId', 'contentType'])
export class Bookmark {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  /** The full URL, stored exactly as the client sent it (D12). */
  @Column({ type: 'text' })
  url!: string;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  excerpt!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  /** Star/favorite flag (M10, Raindrop parity G1). */
  @Column({ type: 'boolean', default: false })
  favorite!: boolean;

  /** Classified content type (M10, Raindrop parity G7). */
  @Column({
    type: 'enum',
    enum: CONTENT_TYPES,
    enumName: 'bookmark_content_type',
    name: 'content_type',
    default: 'link',
  })
  contentType!: ContentType;

  /** Set by metadata fetching in M6; stays null until then. */
  @Column({ type: 'text', name: 'cover_ref', nullable: true })
  coverRef!: string | null;

  /** Set by icon fetching in M6; stays null until then. */
  @Column({ type: 'text', name: 'icon_ref', nullable: true })
  iconRef!: string | null;

  // -- Derived URL parts (D12) — recomputed on every url write -------------

  @Column({ type: 'text' })
  scheme!: string;

  /** Hostname without port (the port lives in its own column). */
  @Column({ type: 'text' })
  host!: string;

  /**
   * Registrable domain per the Public Suffix List (`tldts`), lowercased —
   * `www.example.co.uk` → `example.co.uk`. `null` for IP hosts and
   * single-label hostnames without a known suffix.
   */
  @Column({ type: 'text', nullable: true })
  domain!: string | null;

  /** Explicit port; `null` when absent or the scheme default. */
  @Column({ type: 'text', nullable: true })
  port!: string | null;

  /** Always present (WHATWG URL): `''` only for non-hierarchical schemes. */
  @Column({ type: 'text' })
  path!: string;

  /** Query WITHOUT the leading `?`; `null` when the url has none. */
  @Column({ type: 'text', nullable: true })
  query!: string | null;

  /** Fragment WITHOUT the leading `#`; `null` when the url has none. */
  @Column({ type: 'text', nullable: true })
  fragment!: string | null;

  // -- Lifecycle ------------------------------------------------------------

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /**
   * Trash marker (soft delete, D17). Deliberately a PLAIN column, not
   * `@DeleteDateColumn`: TypeORM's soft-delete magic silently appends
   * `deleted_at IS NULL` to repository finds and query builders, which
   * contradicts the explicit trash conditions this milestone needs
   * (`trashed=true` lists, the retention purge). Every read here states its
   * trash scope explicitly instead.
   *
   * Trash sets it (a plain UPDATE); the daily purge hard-deletes the row.
   */
  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt!: Date | null;
}
