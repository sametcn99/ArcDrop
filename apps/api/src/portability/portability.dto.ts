import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class ExportDataDto {
  @ApiProperty({ enum: ['json', 'csv', 'html', 'txt'], description: 'Output format' })
  @IsIn(['json', 'csv', 'html', 'txt'])
  format!: 'json' | 'csv' | 'html' | 'txt';

  /**
   * Scope the export to one collection's subtree (the collection included).
   * Unknown or trashed collections are 404s — the trash is not exported.
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  collectionId?: string;
}

export class ImportSummaryEntryDto {
  @ApiProperty({ description: 'What was skipped and why' })
  @IsString()
  reason!: string;

  @ApiPropertyOptional({ description: 'Where in the upload this came from' })
  @IsOptional()
  @IsString()
  source?: string;
}

export class ImportSummaryDto {
  @ApiProperty({ description: 'Bookmarks created' })
  @IsInt()
  created!: number;

  @ApiProperty({ description: 'Bookmarks matched by URL and updated (D13 upsert)' })
  @IsInt()
  updated!: number;

  @ApiProperty({
    type: [ImportSummaryEntryDto],
    description: 'Rows intentionally not imported, each with a reason',
  })
  skipped!: ImportSummaryEntryDto[];

  @ApiProperty({
    type: [ImportSummaryEntryDto],
    description: 'Rows that failed, each with a reason',
  })
  errors!: ImportSummaryEntryDto[];
}

/** Query params of `GET /bookmarks/{id}/highlights/export` (M8 G4). */
export class ExportHighlightsQueryDto {
  @ApiProperty({ enum: ['txt', 'csv'] })
  @IsIn(['txt', 'csv'])
  format!: 'txt' | 'csv';
}

// -- MCP import tool DTO (base64 payload — the REST route takes multipart) ----

/**
 * MCP `importData` cap: the DECODED payload may be 1 MiB. The base64 text
 * grows by 4/3, so the wire string allows ~1.4 MB; the JSON body limit
 * (2 MB, set in `app-setup.ts`) bounds the request above that.
 */
export const MCP_IMPORT_MAX_DECODED_BYTES = 1_048_576;
const MCP_IMPORT_MAX_BASE64_LENGTH = Math.ceil((MCP_IMPORT_MAX_DECODED_BYTES * 4) / 3) + 4;

export class ImportDataToolDto {
  @ApiProperty({
    enum: ['json', 'csv', 'html', 'txt', 'enex', 'zip'],
    description: 'Payload format (the REST route detects this from the filename)',
  })
  @IsIn(['json', 'csv', 'html', 'txt', 'enex', 'zip'])
  format!: 'json' | 'csv' | 'html' | 'txt' | 'enex' | 'zip';

  @ApiProperty({
    description: `Base64-encoded file content, decoded cap ${MCP_IMPORT_MAX_DECODED_BYTES} bytes`,
    maxLength: MCP_IMPORT_MAX_BASE64_LENGTH,
  })
  @IsString()
  @MaxLength(MCP_IMPORT_MAX_BASE64_LENGTH)
  data!: string;
}

export class ExportScopeInfoDto {
  @ApiProperty({ format: 'uuid' })
  collectionId!: string;

  @ApiProperty({ type: [String], description: 'Root→leaf title path of the scoped collection' })
  collectionPath!: string[];
}

/** Meta section carried at the top of every JSON export document. */
export class ExportDocumentMetaDto {
  @ApiProperty({ example: 'arcdrop/v1' })
  format!: string;

  @ApiProperty({ format: 'date-time' })
  exportedAt!: string;

  @ApiPropertyOptional({ type: ExportScopeInfoDto, nullable: true })
  scope!: ExportScopeInfoDto | null;
}
