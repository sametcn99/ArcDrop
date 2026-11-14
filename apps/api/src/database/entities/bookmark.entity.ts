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
 * Permanent-copy archive status for a bookmark (plan M17 / D19, parity G16).
 * - `pending`: queued / not yet attempted (default on create)
 * - `ready`: extracted HTML + plain text written to volume & `archiveText` indexed
 * - `failed`: transient error (5xx / network / timeout); scheduled for backoff retry
 * - `invalid-origin`: paywalled, login-walled, or auth-blocked origin (401/402/403/login form)
 * - `skipped`: non-archivable (media binary, oversized > archiveMaxBytes, SSRF refusal, trashed)
 */
export const CACHE_STATUSES = ['pending', 'ready', 'failed', 'invalid-origin', 'skipped'] as const;

export type CacheStatus = (typeof CACHE_STATUSES)[number];

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
 * A user's bookmark (plan M3, D12/D13; enriched M10; library health M12;
 * reminders M14; archive & FTS M17).
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
@Index('IX_bookmarks_user_broken_at', ['userId', 'brokenAt'])
@Index('IX_bookmarks_user_reminder_at', ['userId', 'reminderAt'])
@Index('IX_bookmarks_reminder_due', ['reminderAt', 'remindedAt', 'deletedAt'])
@Index('IX_bookmarks_user_cache_status', ['userId', 'cacheStatus'])
@Index('IX_bookmarks_cache_retry', ['cacheStatus', 'cacheNextRetryAt', 'deletedAt'])
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

  // -- Library health / broken-link state (M12) ----------------------------

  @Column({ type: 'timestamptz', name: 'last_checked_at', nullable: true })
  lastCheckedAt!: Date | null;

  @Column({ type: 'text', name: 'broken_reason', nullable: true })
  brokenReason!: string | null;

  /** Null = healthy (or not yet checked); non-null = flagged broken since this timestamp. */
  @Column({ type: 'timestamptz', name: 'broken_at', nullable: true })
  brokenAt!: Date | null;

  // -- Reminders (M14 / G12) -----------------------------------------------

  /** One-time reminder instant stored in UTC (`timestamptz`); null when unset. */
  @Column({ type: 'timestamptz', name: 'reminder_at', nullable: true })
  reminderAt!: Date | null;

  /** When the current `reminderAt` fired; prevents refiring on subsequent sweeps. */
  @Column({ type: 'timestamptz', name: 'reminded_at', nullable: true })
  remindedAt!: Date | null;

  // -- Archive & Full-Text Search (M17 / D19 / G16) ------------------------

  @Column({
    type: 'enum',
    enum: CACHE_STATUSES,
    enumName: 'bookmark_cache_status',
    name: 'cache_status',
    default: 'pending',
  })
  cacheStatus!: CacheStatus;

  @Column({ type: 'timestamptz', name: 'cache_checked_at', nullable: true })
  cacheCheckedAt!: Date | null;

  @Column({ type: 'integer', name: 'cache_retry_count', default: 0, select: false })
  cacheRetryCount!: number;

  @Column({ type: 'timestamptz', name: 'cache_next_retry_at', nullable: true, select: false })
  cacheNextRetryAt!: Date | null;

  @Column({ type: 'text', name: 'cache_error', nullable: true, select: false })
  cacheError!: string | null;

  /** Truncated plain text extracted from HTML/PDF archive (FTS source). */
  @Column({ type: 'text', name: 'archive_text', nullable: true, select: false })
  archiveText!: string | null;

  /** Postgres STORED generated tsvector (`simple` config) indexed by GIN. */
  @Column({
    type: 'tsvector',
    name: 'search_vector',
    select: false,
    insert: false,
    update: false,
    nullable: true,
  })
  searchVector?: string | null;

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
