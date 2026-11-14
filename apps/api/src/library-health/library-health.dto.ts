import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { BookmarkDto } from '@api/bookmarks/bookmarks.dto';

export const MAX_DUPLICATE_RESOLVE_TRASH_IDS = 200;

export class DuplicateGroupDto {
  @ApiProperty({ description: 'Canonical normalized URL shared by every bookmark in the group' })
  normalizedUrl!: string;

  @ApiProperty({
    type: BookmarkDto,
    description: 'Oldest active bookmark in the group (`createdAt ASC, id ASC`)',
  })
  original!: BookmarkDto;

  @ApiProperty({
    type: [BookmarkDto],
    description: 'Newer duplicate copies safe to review or trash',
  })
  extras!: BookmarkDto[];
}

export class DuplicateGroupsResponseDto {
  @ApiProperty({ type: [DuplicateGroupDto] })
  groups!: DuplicateGroupDto[];
}

export class ResolveDuplicatesDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Active bookmark ID to keep; tags and collection memberships from trashIds merge into it',
  })
  @IsUUID()
  keepId!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    minItems: 1,
    maxItems: MAX_DUPLICATE_RESOLVE_TRASH_IDS,
    description: 'Active duplicate bookmark IDs to merge into keepId and move to the trash',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DUPLICATE_RESOLVE_TRASH_IDS)
  @IsUUID(undefined, { each: true })
  trashIds!: string[];
}

export class ResolveDuplicatesResponseDto {
  @ApiProperty({
    type: BookmarkDto,
    description: 'Surviving keeper bookmark after tag/collection merge',
  })
  kept!: BookmarkDto;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Unique bookmark IDs moved to the trash',
  })
  trashedIds!: string[];
}
