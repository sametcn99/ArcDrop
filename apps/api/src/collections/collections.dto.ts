import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
/** Cap for one reorder batch (`PATCH /collections/order`). */
export const MAX_ORDER_ITEMS = 1000;

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
