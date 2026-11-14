import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreatePersonalAccessTokenDto {
  /** Human label — shown in listings ("Claude Desktop", "CI export job"). */
  @ApiProperty({ example: 'Claude Desktop', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /**
   * `scope: read-only` (M7): the token may only call safe REST reads and
   * read-only MCP tools; every mutation is refused at the guard level
   * (REST) or per-tool (MCP).
   */
  @ApiPropertyOptional({ default: false, description: 'true = the token can never mutate data' })
  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}

/** Listing shape — NEVER includes the token itself (returned exactly once). */
export class PersonalAccessTokenDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'true = scope read-only (mutations refused)' })
  readOnly!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ nullable: true, format: 'date-time' })
  lastUsedAt!: Date | null;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Set once the token was revoked',
  })
  revokedAt!: Date | null;
}

export class CreatedPersonalAccessTokenDto extends PersonalAccessTokenDto {
  /** The raw token — shown EXACTLY ONCE, in this response, never again. */
  @ApiProperty({
    description: 'The raw token (arcdrop_pat_…). Store it now; it is not recoverable.',
  })
  token!: string;
}

export class PersonalAccessTokenIdParamDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;
}

export class PersonalAccessTokenListDto {
  @ApiProperty({ type: [PersonalAccessTokenDto] })
  items!: PersonalAccessTokenDto[];
}
