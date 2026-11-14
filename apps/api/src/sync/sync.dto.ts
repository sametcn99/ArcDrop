import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { BookmarkDto, HighlightDto } from '@api/bookmarks/bookmarks.dto';

/** Page size for `/sync/changes` — above 200 is CLAMPED, like bookmark paging. */
export const DEFAULT_SYNC_PAGE_SIZE = 100;
export const MAX_SYNC_PAGE_SIZE = 200;

/**
 * Cursors are decimal strings — `seq` columns are pg `bigint` and exceed
 * JavaScript's safe integer range, so they travel as strings end to end
 * (events, ws payloads, cursors). No leading zeros, ≤ 19 digits.
 */
const SYNC_CURSOR_PATTERN = /^(?:0|[1-9][0-9]{0,18})$/;

export class GetSyncChangesQueryDto {
  /**
   * The last seq the client holds ("I have everything ≤ since"). Defaults
   * to `0` (from the beginning). A cursor that predates the oldest retained
   * event answers `resyncRequired: true` instead of a partial delta.
   */
  @ApiPropertyOptional({
    pattern: SYNC_CURSOR_PATTERN.source,
    example: '42',
    description: 'Cursor: the last seq the client holds (decimal string, pg bigint range)',
  })
  @IsOptional()
  @IsString()
  @Matches(SYNC_CURSOR_PATTERN, {
    message: 'since must be a non-negative decimal integer (pg bigint range)',
  })
  since?: string;

  @ApiPropertyOptional({
    minimum: 1,
    default: DEFAULT_SYNC_PAGE_SIZE,
    maximum: MAX_SYNC_PAGE_SIZE,
    description: `Events per page (1–${MAX_SYNC_PAGE_SIZE}); larger values are clamped`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class SyncStateDto {
  /** The caller's current change-log seq (decimal string; bigint-safe). */
  @ApiProperty({ example: '42' })
  seq!: string;
}

export class TagSnapshotDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class CollectionSnapshotDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  parentId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty({ nullable: true })
  icon!: string | null;

  @ApiProperty({ nullable: true })
  color!: string | null;

  @ApiProperty()
  order!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ nullable: true, description: 'Trash marker (plain soft delete)' })
  deletedAt!: Date | null;
}

export class HighlightSnapshotDto extends HighlightDto {}

/**
 * The entity's current state at delta time: a full row for
 * create/update (bookmarks reuse `BookmarkDto` and highlights reuse
 * `HighlightDto` exactly), `null` for delete tombstones (and defensively
 * whenever the row has vanished — the entity does not exist now).
 */
export type SyncSnapshot =
  BookmarkDto | TagSnapshotDto | CollectionSnapshotDto | HighlightSnapshotDto | null;

export class SyncChangeDto {
  /** Event seq (decimal string, bigint-safe). Strictly ascending across pages. */
  @ApiProperty({ example: '42' })
  seq!: string;

  @ApiProperty({ enum: ['bookmark', 'tag', 'collection', 'highlight'] })
  entity!: 'bookmark' | 'tag' | 'collection' | 'highlight';

  @ApiProperty({ format: 'uuid' })
  id!: string;

  /** `delete` is only ever a HARD delete (trash/restore arrive as `update`). */
  @ApiProperty({ enum: ['create', 'update', 'delete'] })
  action!: 'create' | 'update' | 'delete';

  @ApiProperty({
    oneOf: [
      { $ref: '#/components/schemas/BookmarkDto' },
      { $ref: '#/components/schemas/TagSnapshotDto' },
      { $ref: '#/components/schemas/CollectionSnapshotDto' },
      { $ref: '#/components/schemas/HighlightSnapshotDto' },
    ],
    nullable: true,
    description: 'Current entity snapshot; null = tombstone (the entity no longer exists)',
  })
  snapshot!: SyncSnapshot;
}

export class SyncChangesDto {
  /**
   * True when `since` predates the oldest retained event (log compaction):
   * the delta would silently miss data, so the client must refetch its
   * lists (`GET /bookmarks`, `GET /collections`) and adopt `cursor` as its
   * new cursor. `changes` is empty in that case.
   */
  @ApiProperty()
  resyncRequired!: boolean;

  @ApiProperty({ type: [SyncChangeDto], description: 'In seq order (ascending), gapless per user' })
  changes!: SyncChangeDto[];

  /** The cursor to persist: the last returned seq, or the request's since when empty. */
  @ApiProperty({ example: '58' })
  cursor!: string;
}

export class SyncTicketDto {
  /** Present on the ws handshake as `?ticket=` — single use, 60s TTL. */
  @ApiProperty({ description: 'One-time websocket ticket (single use, 60s TTL)' })
  ticket!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}
