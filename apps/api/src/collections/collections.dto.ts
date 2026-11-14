import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const MAX_COLLECTION_TITLE_LENGTH = 255;
export const MAX_COLLECTION_ICON_LENGTH = 255;
export const MAX_COLLECTION_COLOR_LENGTH = 32;
/** Cap for one bookmark's collection set (`PUT /bookmarks/{id}/collections`). */
export const MAX_COLLECTIONS_PER_BOOKMARK = 100;
/** Cap for one reorder batch (`PATCH /collections/order`, `PATCH /collections/{id}/bookmarks/order`). */
export const MAX_ORDER_ITEMS = 1000;
/** Cap for one collection merge batch (`POST /collections/merge`). */
export const MAX_BULK_COLLECTION_IDS = 500;

/** Query-string boolean: `true/1` → true, `false/0/''` → false, else invalid. */
const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true || value === 1 || value === '1') return true;
  if (value === 'false' || value === false || value === 0 || value === '0' || value === '') {
    return false;
  }
  return value;
};

export class CreateCollectionDto {
  @ApiProperty({ maxLength: MAX_COLLECTION_TITLE_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_COLLECTION_TITLE_LENGTH)
  title!: string;

  @ApiPropertyOptional({ maxLength: MAX_COLLECTION_ICON_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COLLECTION_ICON_LENGTH)
  icon?: string | null;

  @ApiPropertyOptional({ maxLength: MAX_COLLECTION_COLOR_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COLLECTION_COLOR_LENGTH)
  color?: string | null;

  /** Omit or `null` → root; otherwise a collection owned by the caller. */
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

/**
 * PUT semantics: provided fields replace, absent fields stay. `icon`/`color`
 * accept explicit `null` to clear; `parentId: null` moves to the root level.
 * Moving under one of the collection's own descendants is a 409 (cycle).
 */
export class UpdateCollectionDto {
  @ApiPropertyOptional({ maxLength: MAX_COLLECTION_TITLE_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_COLLECTION_TITLE_LENGTH)
  title?: string;

  @ApiPropertyOptional({ maxLength: MAX_COLLECTION_ICON_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COLLECTION_ICON_LENGTH)
  icon?: string | null;

  @ApiPropertyOptional({ maxLength: MAX_COLLECTION_COLOR_LENGTH, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COLLECTION_COLOR_LENGTH)
  color?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}

export class UpdateCollectionShareDto {
  @ApiProperty({
    description:
      'true to enable unauthenticated public sharing & RSS (keeps existing token if already enabled, ' +
      'mints a fresh 192-bit token otherwise); false to disable and clear the token so re-enabling rotates it',
  })
  @IsBoolean()
  enabled!: boolean;
}

export class CollectionShareDto {
  @ApiProperty({ description: 'Whether unauthenticated public sharing is enabled (M19)' })
  enabled!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'Unguessable 192-bit share token when enabled; null otherwise (M19)',
  })
  shareToken!: string | null;
}

export class CollectionShareResponseDto {
  @ApiProperty({ format: 'uuid' })
  collectionId!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({
    nullable: true,
    description: 'Unguessable share token when enabled; null when disabled',
  })
  shareToken!: string | null;

  @ApiProperty({
    nullable: true,
    example: '/api/v1/public/collections/Vx8kQ2mN9rT1pZ4wX7yB3cD6eF0gH5jK',
    description: 'Relative unauthenticated JSON API path when enabled; null when disabled',
  })
  publicPath!: string | null;

  @ApiProperty({
    nullable: true,
    example: '/api/v1/public/collections/Vx8kQ2mN9rT1pZ4wX7yB3cD6eF0gH5jK/rss',
    description: 'Relative unauthenticated RSS 2.0 feed path when enabled; null when disabled',
  })
  rssPath!: string | null;
}

export class ListCollectionsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter active collections by public sharing state (`true` = shared, `false` = unshared)',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  shared?: boolean;
}

export class CollectionOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  /** Position within the sibling group; smaller sorts earlier. `≥ 0`. */
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order!: number;
}

/**
 * Explicit positions for the listed collections. Unspecified siblings keep
 * their current `order`. Duplicate ids in one payload are a validation error.
 */
export class ReorderCollectionsDto {
  @ApiProperty({ type: [CollectionOrderItemDto], maxItems: MAX_ORDER_ITEMS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ORDER_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CollectionOrderItemDto)
  items!: CollectionOrderItemDto[];
}

export class BookmarkOrderItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  bookmarkId!: string;

  /** Position within this collection; smaller sorts earlier. `≥ 0`. */
  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order!: number;
}

/**
 * Explicit manual positions for the listed bookmarks inside one collection
 * (plan D21, M16). Unspecified members keep their current `order`. Duplicate
 * `bookmarkId` values in one payload are a validation error.
 */
export class ReorderCollectionBookmarksDto {
  @ApiProperty({ type: [BookmarkOrderItemDto], minItems: 1, maxItems: MAX_ORDER_ITEMS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ORDER_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => BookmarkOrderItemDto)
  items!: BookmarkOrderItemDto[];
}

export class ReplaceBookmarkCollectionsDto {
  /** The complete new collection set — exact replacement (plan D5). */
  @ApiProperty({ type: [String], format: 'uuid', maxItems: MAX_COLLECTIONS_PER_BOOKMARK })
  @IsArray()
  @ArrayMaxSize(MAX_COLLECTIONS_PER_BOOKMARK)
  @IsUUID(undefined, { each: true })
  collectionIds!: string[];
}

export class CollectionIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

/** `?cascade=trash` is the only accepted value. */
export class DeleteCollectionQueryDto {
  @ApiPropertyOptional({ enum: ['trash'], description: 'trash = trash the whole subtree' })
  @IsOptional()
  @IsIn(['trash'])
  cascade?: 'trash';
}

export class CollectionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ nullable: true, format: 'uuid', description: 'null for roots' })
  parentId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  icon!: string | null;

  @ApiProperty({ nullable: true })
  color!: string | null;

  @ApiProperty({ description: 'Sibling position; smaller sorts earlier' })
  order!: number;

  @ApiProperty({ description: 'Active bookmarks directly in this collection' })
  bookmarkCount!: number;

  @ApiProperty({ type: CollectionShareDto, description: 'Public sharing state (M19)' })
  share!: CollectionShareDto;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class CollectionNodeDto extends CollectionDto {
  @ApiProperty({ type: () => [CollectionNodeDto], description: 'Child collections, ordered' })
  children!: CollectionNodeDto[];
}

/** Flat rows of `GET /collections`, grouped per parent, siblings ordered. */
export class CollectionListDto {
  @ApiProperty({ type: [CollectionDto] })
  items!: CollectionDto[];
}

/** A collection reference as it appears in a bookmark's membership view. */
export class BookmarkCollectionRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;
}

/** Result of `PUT /bookmarks/{id}/collections` — the resulting membership set. */
export class BookmarkCollectionsDto {
  @ApiProperty({ type: [BookmarkCollectionRefDto] })
  collections!: BookmarkCollectionRefDto[];
}

export class MergeCollectionsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: MAX_BULK_COLLECTION_IDS,
    description: `Active source collection IDs to merge into targetId (1–${MAX_BULK_COLLECTION_IDS})`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_COLLECTION_IDS)
  @IsUUID(undefined, { each: true })
  sourceIds!: string[];

  @ApiProperty({ format: 'uuid', description: 'Active target collection ID' })
  @IsUUID()
  targetId!: string;
}

export class MergeCollectionsResponseDto {
  @ApiProperty({ type: CollectionDto })
  target!: CollectionDto;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Merged source collection IDs moved to the trash',
  })
  trashedIds!: string[];

  @ApiProperty({ description: 'Number of direct child collections reparented under target' })
  movedChildren!: number;

  @ApiProperty({ description: 'Number of distinct bookmarks whose memberships moved to target' })
  movedBookmarks!: number;
}

export class SortCollectionsResponseDto {
  @ApiProperty({ description: 'Number of active collections whose sibling order changed' })
  updated!: number;
}

export class DeleteEmptyCollectionsResponseDto {
  @ApiProperty({ description: 'Number of empty collections moved to the trash' })
  trashed!: number;

  @ApiProperty({ description: 'Number of active collections kept' })
  kept!: number;
}
