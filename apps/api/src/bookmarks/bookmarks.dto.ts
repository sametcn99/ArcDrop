import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_COLLECTIONS_PER_BOOKMARK } from '@api/collections/collections.dto';
import { CONTENT_TYPES, type ContentType } from '@api/database/entities/bookmark.entity';

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_TAG_NAME_LENGTH = 100;
export const MAX_TAGS_PER_BOOKMARK = 50;
export const MAX_BULK_BOOKMARK_IDS = 500;
export const MAX_HIGHLIGHT_TEXT_LENGTH = 10_000;
export const MAX_HIGHLIGHT_NOTE_LENGTH = 10_000;
export const MAX_HIGHLIGHT_COLOR_LENGTH = 32;

export const BULK_BOOKMARK_ACTIONS = [
  'move',
  'addTags',
  'removeTags',
  'trash',
  'restore',
  'delete',
] as const;
export type BulkBookmarkAction = (typeof BULK_BOOKMARK_ACTIONS)[number];

export const BULK_MOVE_MODES = ['assign', 'union'] as const;
export type BulkMoveMode = (typeof BULK_MOVE_MODES)[number];

export const BOOKMARK_SORTS = ['updated', 'created', 'title', 'manual'] as const;
export type BookmarkSort = (typeof BOOKMARK_SORTS)[number];

/** Query-string boolean: `true/1` → true, `false/0/''` → false, else invalid. */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true || value === 1 || value === '1') return true;
  if (value === 'false' || value === false || value === 0 || value === '0' || value === '') {
    return false;
  }
  return value; // garbage stays non-boolean and fails @IsBoolean
};

export class CreateBookmarkDto {
  /** Full URL — stored verbatim; parts are derived server-side (D12). */
  @ApiProperty({ example: 'https://docs.example.com/guide?page=2#setup', maxLength: 2048 })
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  title?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  excerpt?: string | null;

  @ApiPropertyOptional({ maxLength: 10_000 })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  note?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description:
      'Optional one-time reminder instant in ISO-8601 format (stored in UTC; clients render local time).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  reminderAt?: string | null;
}

/**
 * Request body shape for `POST /bookmarks` — identical to `CreateBookmarkDto`
 * except `url` may instead arrive in the quick-add query string (`?url=…`).
 */
export class CreateBookmarkBodyDto {
  @ApiPropertyOptional({
    example: 'https://docs.example.com/guide?page=2#setup',
    maxLength: 2048,
    description: 'Required unless provided as the `url` query parameter (quick-add)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  title?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  excerpt?: string | null;

  @ApiPropertyOptional({ maxLength: 10_000 })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  note?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description:
      'Optional one-time reminder instant in ISO-8601 format (stored in UTC; clients render local time).',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  reminderAt?: string | null;
}

/**
 * Quick-add query parameters for `POST /bookmarks?url=…&title=…&collection=…`
 * (plan M10, Raindrop parity G2 — RSS share targets & browser share sheets).
 */
export class QuickAddBookmarkQueryDto {
  @ApiPropertyOptional({
    maxLength: 2048,
    description: 'Quick-add URL (same validation as body url)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  excerpt?: string;

  @ApiPropertyOptional({ maxLength: 10_000 })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  note?: string;

  @ApiPropertyOptional({
    maxLength: 255,
    description: 'Optional collection UUID or title (must already exist and be active)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  collection?: string;

  @ApiPropertyOptional({ description: 'Mark bookmark as favorite on quick-add' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  favorite?: boolean;
}

/**
 * PUT semantics: provided fields replace (explicit `null` clears), absent
 * fields stay. A `url` change re-runs the decomposition (D12).
 */
export class UpdateBookmarkDto {
  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ maxLength: 512, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  title?: string | null;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  excerpt?: string | null;

  @ApiPropertyOptional({ maxLength: 10_000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  note?: string | null;

  @ApiPropertyOptional({ description: 'Toggle favorite / star state' })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description:
      'One-time reminder timestamp in ISO-8601 format (stored in UTC; clients render local time). Explicit null clears a pending reminder.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  reminderAt?: string | null;
}

export class BulkBookmarksDto {
  @ApiProperty({
    enum: BULK_BOOKMARK_ACTIONS,
    description:
      'Bulk action to run in a single transaction: move | addTags | removeTags | trash | restore | delete',
  })
  @IsIn(BULK_BOOKMARK_ACTIONS)
  action!: BulkBookmarkAction;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: MAX_BULK_BOOKMARK_IDS,
    description: `Target bookmark IDs (1–${MAX_BULK_BOOKMARK_IDS} per call)`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_BOOKMARK_IDS)
  @IsUUID(undefined, { each: true })
  ids!: string[];

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    maxItems: MAX_COLLECTIONS_PER_BOOKMARK,
    description: 'Required when action="move": target active collection IDs',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COLLECTIONS_PER_BOOKMARK)
  @IsUUID(undefined, { each: true })
  collectionIds?: string[];

  @ApiPropertyOptional({
    enum: BULK_MOVE_MODES,
    default: 'assign',
    description:
      'Used when action="move": "assign" replaces each bookmark’s collections; "union" adds collectionIds while preserving existing memberships',
  })
  @IsOptional()
  @IsIn(BULK_MOVE_MODES)
  mode?: BulkMoveMode;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_TAGS_PER_BOOKMARK,
    description: 'Required when action="addTags" or "removeTags": tag names',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_BOOKMARK)
  @IsString({ each: true })
  @MinLength(1, { each: true, message: 'tag names must not be empty' })
  @MaxLength(MAX_TAG_NAME_LENGTH, { each: true })
  tags?: string[];
}

export class BulkBookmarksResponseDto {
  @ApiProperty({ enum: BULK_BOOKMARK_ACTIONS })
  action!: BulkBookmarkAction;

  @ApiProperty({ description: 'Number of bookmarks modified by the bulk operation' })
  affected!: number;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Unique bookmark IDs modified by the bulk operation',
  })
  ids!: string[];
}

export class ListBookmarksQueryDto {
  /**
   * Search query using the M11/M12/M14 operator grammar (D10/D19). Plain terms
   * remain the degenerate case (case-insensitive ILIKE across title, excerpt,
   * note, url, and tag names).
   */
  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Search query supporting Raindrop-compatible operators: ' +
      'bare `word` / `"exact phrase"` (matches title, excerpt, note, url, tags; supports `\\"` and `\\\\` escapes), ' +
      '`-word` / `-"phrase"` exclusions, ' +
      '`#tag` / `-#tag` / `#"multi word tag"` / `-#"multi word tag"`, ' +
      'field-scoped `title:`, `excerpt:`, `note:`, `link:` (negatable with `-`), ' +
      '`type:<article|image|video|audio|document|book|link>`, ' +
      '`favorite:true|false`, `notag:true|false`, `broken:true|false`, `reminder:true|false`, ' +
      '`created:` / `lastUpdate:` with `[<|>|<=|>=]YYYY[-MM[-DD]]` (UTC), ' +
      'and `match:OR` (OR positive terms; exclusions stay ANDed); ' +
      'Reserved (`file:`) and unknown operators fail with 400 BAD_REQUEST.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  search?: string;

  /** Alias for `search` accepting the exact same operator grammar. */
  @ApiPropertyOptional({
    maxLength: 500,
    description:
      'Alias for `search` — accepts the same M11/M12/M14 search operator grammar. ' +
      'Provide either `search` or `q`, not both.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  q?: string;

  /** Membership filter (D5) — accepted, validated, and active since M4. */
  @ApiPropertyOptional({ format: 'uuid', description: 'Only bookmarks in this collection (D5)' })
  @IsOptional()
  @IsUUID()
  collectionId?: string;

  /** Exact tag name, case-insensitive. */
  @ApiPropertyOptional({ maxLength: MAX_TAG_NAME_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TAG_NAME_LENGTH)
  tag?: string;

  @ApiPropertyOptional({ description: 'Only bookmarks that belong to no collection' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unassignedOnly?: boolean;

  @ApiPropertyOptional({ default: false, description: 'true = the trash, false = active set' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  trashed?: boolean;

  @ApiPropertyOptional({ description: 'Filter by favorite flag (`true` or `false`)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by broken-link status (`true` = flagged broken, `false` = healthy)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  broken?: boolean;

  @ApiPropertyOptional({
    description: 'Filter by reminder existence (`true` = reminderAt set, `false` = none)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  reminder?: boolean;

  @ApiPropertyOptional({ enum: CONTENT_TYPES, description: 'Filter by detected content type' })
  @IsOptional()
  @IsIn(CONTENT_TYPES)
  type?: ContentType;

  @ApiPropertyOptional({ description: 'Exact registrable domain match, case-insensitive' })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  domain?: string;

  @ApiPropertyOptional({
    enum: BOOKMARK_SORTS,
    default: 'updated',
    description:
      'Sort order: `updated` (default, updatedAt desc), `created` (createdAt desc), ' +
      '`title` (case-insensitive asc), or `manual` (membership order asc NULLS LAST; requires `collectionId`, D21).',
  })
  @IsOptional()
  @IsIn(BOOKMARK_SORTS)
  sort?: BookmarkSort;

  @ApiPropertyOptional({ minimum: 1, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Above `MAX_PAGE_SIZE` (200) the service CLAMPS to 200 (ticket AC). */
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({ format: 'date-time', description: 'ISO-8601; only later updatedAt rows' })
  @IsOptional()
  @IsISO8601({ strict: true })
  updatedSince?: string;
}

export class BookmarkIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class HighlightIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class CreateHighlightDto {
  @ApiProperty({ maxLength: MAX_HIGHLIGHT_TEXT_LENGTH, example: 'Key passage from the article' })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_HIGHLIGHT_TEXT_LENGTH)
  text!: string;

  @ApiPropertyOptional({ maxLength: MAX_HIGHLIGHT_NOTE_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HIGHLIGHT_NOTE_LENGTH)
  note?: string | null;

  @ApiPropertyOptional({ maxLength: MAX_HIGHLIGHT_COLOR_LENGTH, nullable: true, example: 'yellow' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HIGHLIGHT_COLOR_LENGTH)
  color?: string | null;
}

export class UpdateHighlightDto {
  @ApiPropertyOptional({ maxLength: MAX_HIGHLIGHT_TEXT_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_HIGHLIGHT_TEXT_LENGTH)
  text?: string;

  @ApiPropertyOptional({ maxLength: MAX_HIGHLIGHT_NOTE_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HIGHLIGHT_NOTE_LENGTH)
  note?: string | null;

  @ApiPropertyOptional({ maxLength: MAX_HIGHLIGHT_COLOR_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_HIGHLIGHT_COLOR_LENGTH)
  color?: string | null;
}

export class HighlightDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  bookmarkId!: string;

  @ApiProperty()
  text!: string;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ nullable: true })
  color!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class HighlightListDto {
  @ApiProperty({ type: [HighlightDto] })
  items!: HighlightDto[];
}

/** Path param for `/tags/{name}` — the raw (URL-decoded) tag name. */
export class TagNameParamDto {
  @ApiProperty({ maxLength: MAX_TAG_NAME_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TAG_NAME_LENGTH)
  name!: string;
}

export class ReplaceBookmarkTagsDto {
  /** The complete new tag set — created on demand, exact replacement. */
  @ApiProperty({ type: [String], maxItems: MAX_TAGS_PER_BOOKMARK, example: ['reading', 'Work'] })
  @IsArray()
  @ArrayMaxSize(MAX_TAGS_PER_BOOKMARK)
  @IsString({ each: true })
  @MinLength(1, { each: true, message: 'tag names must not be empty' })
  @MaxLength(MAX_TAG_NAME_LENGTH, { each: true })
  tags!: string[];
}

export class RenameTagDto {
  /** New name; if another tag already holds it (case-insensitive) the tags MERGE. */
  @ApiProperty({ example: 'job', maxLength: MAX_TAG_NAME_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_TAG_NAME_LENGTH)
  name!: string;
}

export class BookmarkUrlPartsDto {
  @ApiProperty() scheme!: string;
  @ApiProperty() host!: string;
  @ApiProperty({ nullable: true }) domain!: string | null;
  @ApiProperty({ nullable: true }) port!: string | null;
  @ApiProperty() path!: string;
  @ApiProperty({ nullable: true }) query!: string | null;
  @ApiProperty({ nullable: true }) fragment!: string | null;
}

export class TagDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Work' })
  name!: string;
}

export class BookmarkDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Stored verbatim (D12)' })
  url!: string;

  @ApiProperty({ nullable: true })
  title!: string | null;

  @ApiProperty({ nullable: true })
  excerpt!: string | null;

  @ApiProperty({ nullable: true })
  note!: string | null;

  @ApiProperty({ description: 'Star/favorite flag (M10)' })
  favorite!: boolean;

  @ApiProperty({ enum: CONTENT_TYPES, description: 'Detected content type (M10)' })
  contentType!: ContentType;

  @ApiProperty({ nullable: true, description: 'Populated by metadata fetching from M6' })
  coverRef!: string | null;

  @ApiProperty({ nullable: true, description: 'Populated by icon fetching from M6' })
  iconRef!: string | null;

  @ApiProperty({ type: BookmarkUrlPartsDto, description: 'Derived on every url write (D12)' })
  urlParts!: BookmarkUrlPartsDto;

  @ApiProperty({ type: [TagDto] })
  tags!: TagDto[];

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Timestamp of the last broken-link check (M12)',
  })
  lastCheckedAt!: Date | null;

  @ApiProperty({
    nullable: true,
    description: 'Machine reason why the URL was flagged broken, null when healthy (M12)',
  })
  brokenReason!: string | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'When the bookmark was first flagged broken, null when healthy (M12)',
  })
  brokenAt!: Date | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description:
      'One-time reminder timestamp stored in UTC (M14; clients render local time). Null when unset.',
  })
  reminderAt!: Date | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description:
      'UTC timestamp when the current reminder fired (M14), preventing refires. Null while pending or unset.',
  })
  remindedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ nullable: true, description: 'Set while the bookmark is in the trash (D17)' })
  deletedAt!: Date | null;
}

export class BookmarkListDto {
  @ApiProperty({ type: [BookmarkDto] })
  items!: BookmarkDto[];

  @ApiProperty({ description: 'Total matching rows BEFORE paging' })
  totalCount!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty({ description: 'Effective page size (clamped to 200)' })
  pageSize!: number;
}

export class BookmarkStatsDto {
  /** Active (non-trashed) bookmarks. */
  @ApiProperty() total!: number;

  /** Active bookmarks that belong to no collection. */
  @ApiProperty() unassigned!: number;

  /** Bookmarks currently in the trash. */
  @ApiProperty() trashed!: number;

  /** Active bookmarks marked as favorite. */
  @ApiProperty() favorites!: number;
}

export class TagUsageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  /** Number of ACTIVE (non-trashed) bookmarks carrying the tag. */
  @ApiProperty()
  count!: number;
}
