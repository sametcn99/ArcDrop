import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_TAG_NAME_LENGTH = 100;
export const MAX_TAGS_PER_BOOKMARK = 50;

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
}

export class ListBookmarksQueryDto {
  /** ILIKE substring across title, url, excerpt and tag names (D10). */
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  /** Reserved — accepted and validated but only honored from M4 (collections). */
  @ApiPropertyOptional({ format: 'uuid', description: 'Reserved — honored from M4' })
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

  @ApiPropertyOptional({ description: 'Exact registrable domain match, case-insensitive' })
  @IsOptional()
  @IsString()
  @MaxLength(253)
  domain?: string;

  @ApiPropertyOptional({ enum: ['updated', 'created', 'title'], default: 'updated' })
  @IsOptional()
  @IsIn(['updated', 'created', 'title'])
  sort?: 'updated' | 'created' | 'title';

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

  @ApiProperty({ nullable: true, description: 'Populated by metadata fetching from M6' })
  coverRef!: string | null;

  @ApiProperty({ nullable: true, description: 'Populated by icon fetching from M6' })
  iconRef!: string | null;

  @ApiProperty({ type: BookmarkUrlPartsDto, description: 'Derived on every url write (D12)' })
  urlParts!: BookmarkUrlPartsDto;

  @ApiProperty({ type: [TagDto] })
  tags!: TagDto[];

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
