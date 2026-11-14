import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export const AUDIT_DEFAULT_PAGE_SIZE = 50;
export const AUDIT_MAX_PAGE_SIZE = 200;

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({
    example: 'admin.user.create',
    maxLength: 100,
    description:
      'Exact action filter (e.g. mcp.tools.call, admin.user.create, admin.settings.update)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by acting user id' })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @ApiPropertyOptional({ enum: ['jwt', 'pat'], description: 'Filter by authentication kind' })
  @IsOptional()
  @IsIn(['jwt', 'pat'])
  actorType?: 'jwt' | 'pat';

  @ApiPropertyOptional({ enum: ['ok', 'error'], description: 'Filter by action outcome' })
  @IsOptional()
  @IsIn(['ok', 'error'])
  outcome?: 'ok' | 'error';

  @ApiPropertyOptional({
    maxLength: 200,
    description: 'Exact subject filter (tool name, target user id, or instance)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'ISO-8601 timestamp; entries at or after this instant',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  since?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'ISO-8601 timestamp; entries at or before this instant',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  until?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: AUDIT_MAX_PAGE_SIZE,
    default: AUDIT_DEFAULT_PAGE_SIZE,
    description: `Page size (above ${AUDIT_MAX_PAGE_SIZE} is clamped)`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class AuditLogEntryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Acting user id (no FK; outlives user deletion)' })
  userId!: string;

  @ApiProperty({ format: 'uuid', nullable: true, description: 'PAT id when authenticated via PAT' })
  patId!: string | null;

  @ApiProperty({ enum: ['jwt', 'pat'] })
  actorType!: 'jwt' | 'pat';

  @ApiProperty({ example: 'admin.user.create' })
  action!: string;

  @ApiProperty({ nullable: true, example: 'createBookmark' })
  subject!: string | null;

  @ApiProperty({ enum: ['ok', 'error'] })
  outcome!: 'ok' | 'error';

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'Structured metadata (never contains raw credentials or tokens)',
  })
  detail!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, description: 'Correlation x-request-id of the HTTP request' })
  requestId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class AuditLogListDto {
  @ApiProperty({ type: [AuditLogEntryDto] })
  items!: AuditLogEntryDto[];

  @ApiProperty({ description: 'Total matching entries BEFORE paging' })
  totalCount!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty({ description: `Effective page size (clamped to ${AUDIT_MAX_PAGE_SIZE})` })
  pageSize!: number;
}
