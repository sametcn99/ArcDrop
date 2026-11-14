import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MAX_COLLECTIONS_PER_BOOKMARK } from '@api/collections/collections.dto';
import { CONTENT_TYPES, type ContentType } from '@api/database/entities/bookmark.entity';

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true || value === 1 || value === '1') return true;
  if (value === 'false' || value === false || value === 0 || value === '0' || value === '') {
    return false;
  }
  return value;
};

/**
 * MCP `uploadBookmarkFile` cap: 1 MiB decoded base64 (matches `MCP_IMPORT_MAX_DECODED_BYTES`,
 * fitting comfortably inside `/api/v1/mcp`'s 2 MiB JSON body cap). Larger uploads up to
 * `settings.fileMaxBytes` (default 300 MiB) use REST `POST /api/v1/bookmarks/file` multipart.
 */
export const MCP_FILE_UPLOAD_MAX_DECODED_BYTES = 1_048_576;
const MCP_FILE_UPLOAD_MAX_BASE64_LENGTH =
  Math.ceil((MCP_FILE_UPLOAD_MAX_DECODED_BYTES * 4) / 3) + 4;

export class FileIdParamDto {
  @ApiProperty({
    maxLength: 128,
    description: 'Bookmark UUID or file storage reference (`fileRef`)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  id!: string;
}

export class GetFileQueryDto {
  @ApiPropertyOptional({
    description: 'Set true/1 to serve Content-Disposition: attachment instead of inline',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  download?: boolean;
}

export class FileMetadataDto {
  @ApiProperty({ format: 'uuid' })
  bookmarkId!: string;

  @ApiProperty()
  fileRef!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  fileMime!: string;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty({ enum: CONTENT_TYPES })
  contentType!: ContentType;

  @ApiProperty({ example: '/api/v1/files/550e8400-e29b-41d4-a716-446655440000' })
  downloadPath!: string;

  @ApiPropertyOptional({
    description: 'Base64-encoded file bytes (returned via MCP when fileSize <= 1 MiB)',
  })
  data?: string;

  @ApiPropertyOptional({
    description: 'Explanatory note when bytes are omitted over MCP due to size cap',
  })
  _note?: string;
}

export class UploadBookmarkFileToolDto {
  @ApiProperty({ example: 'notes.md', maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiPropertyOptional({ example: 'text/markdown', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;

  @ApiProperty({
    description: `Base64-encoded file bytes, decoded cap ${MCP_FILE_UPLOAD_MAX_DECODED_BYTES} bytes (use REST POST /bookmarks/file for files up to fileMaxBytes)`,
    maxLength: MCP_FILE_UPLOAD_MAX_BASE64_LENGTH,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(MCP_FILE_UPLOAD_MAX_BASE64_LENGTH)
  data!: string;

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

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  favorite?: boolean;

  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(100, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: MAX_COLLECTIONS_PER_BOOKMARK })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_COLLECTIONS_PER_BOOKMARK)
  @IsUUID(undefined, { each: true })
  collectionIds?: string[];

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  reminderAt?: string | null;
}
