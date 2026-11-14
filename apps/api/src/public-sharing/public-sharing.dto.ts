import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@api/bookmarks/bookmarks.dto';
import { CONTENT_TYPES, type ContentType } from '@api/database/entities/bookmark.entity';

/**
 * Path parameter for `/public/collections/:shareToken`. Accepts any non-empty
 * string up to 256 chars (no format regex) so malformed, disabled, trashed,
 * and unknown tokens all reach the service and fail identically with 404
 * (preventing token-format existence leaks).
 */
export class PublicShareTokenParamDto {
  @ApiProperty({ description: 'Unguessable collection share token' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  shareToken!: string;
}

export class PublicCollectionQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: `Bookmarks per page (1–${MAX_PAGE_SIZE}; larger values are clamped)`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional child collection UUID within the shared subtree to filter bookmarks by',
  })
  @IsOptional()
  @IsUUID()
  collectionId?: string;
}

export class PublicCollectionNodeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    description: 'Null for the shared root collection (private ancestor IDs are never exposed)',
  })
  parentId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  icon!: string | null;

  @ApiProperty({ nullable: true })
  color!: string | null;

  @ApiProperty()
  order!: number;

  @ApiProperty({ description: 'Active bookmarks directly in this collection' })
  bookmarkCount!: number;

  @ApiProperty({ type: () => [PublicCollectionNodeDto] })
  children!: PublicCollectionNodeDto[];
}

/**
 * Strictly allowlisted public bookmark projection (M19 / D19).
 * Contains ONLY: title, url, excerpt, coverRef, iconRef, tags, contentType, createdAt.
 * Notes, highlights, private file references/bytes, reminders, and broken-link
 * diagnostics are NEVER exposed publicly.
 */
export class PublicBookmarkDto {
  @ApiProperty({ nullable: true })
  title!: string | null;

  @ApiProperty({
    nullable: true,
    description: 'Bookmarked URL (null for file-backed items, whose file bytes stay private)',
  })
  url!: string | null;

  @ApiProperty({ nullable: true })
  excerpt!: string | null;

  @ApiProperty({ nullable: true })
  coverRef!: string | null;

  @ApiProperty({ nullable: true })
  iconRef!: string | null;

  @ApiProperty({ type: [String], description: 'Tag names attached to the bookmark' })
  tags!: string[];

  @ApiProperty({ enum: CONTENT_TYPES })
  contentType!: ContentType;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class PublicCollectionPageDto {
  @ApiProperty({
    type: PublicCollectionNodeDto,
    description: 'Shared collection root with active nested child collections',
  })
  collection!: PublicCollectionNodeDto;

  @ApiProperty({
    example: 'Engineering / Rust',
    description: 'Active collection hierarchy path resolved for the shared root',
  })
  collectionPath!: string;

  @ApiProperty({ type: [PublicBookmarkDto] })
  items!: PublicBookmarkDto[];

  @ApiProperty({ description: 'Total active bookmarks matching across the shared subtree' })
  totalCount!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty({ description: 'Effective page size (clamped to 200)' })
  pageSize!: number;
}
