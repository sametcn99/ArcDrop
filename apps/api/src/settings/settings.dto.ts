import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const BROKEN_LINK_CHECK_MODES = ['off', 'basic', 'default', 'strict'] as const;
export type BrokenLinkCheckMode = (typeof BROKEN_LINK_CHECK_MODES)[number];

/** Default per-item archive size cap (~70 MiB, Raindrop parity). */
export const DEFAULT_ARCHIVE_MAX_BYTES = 70 * 1024 * 1024; // 73_400_320
export const MIN_ARCHIVE_MAX_BYTES = 1024;
export const MAX_ARCHIVE_MAX_BYTES = 500 * 1024 * 1024; // 524_288_000

/** The runtime instance settings (plan D16; extended M12, M17) with their defaults. */
export class SettingsDto {
  @ApiProperty({ description: 'Whether POST /auth/register creates accounts (plan D3)' })
  registrationOpen!: boolean;

  @ApiProperty({ description: 'Trash auto-purge window in days (plan D17)' })
  trashRetentionDays!: number;

  @ApiProperty({ description: 'Change-log retention window in days (plan D4)' })
  changeLogRetentionDays!: number;

  @ApiProperty({
    enum: BROKEN_LINK_CHECK_MODES,
    description:
      'Broken-link checker detection mode (M12): off = disabled, basic = 404/410 only, ' +
      'default = +DNS/dead domain, strict = +5xx/timeouts/redirect-chains',
  })
  brokenLinkCheckMode!: BrokenLinkCheckMode;

  @ApiProperty({
    description:
      'Maximum response size in bytes for per-item page/PDF archiving (M17, default 70 MiB)',
  })
  archiveMaxBytes!: number;
}

export class UpdateSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  registrationOpen?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  trashRetentionDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  changeLogRetentionDays?: number;

  @ApiPropertyOptional({
    enum: BROKEN_LINK_CHECK_MODES,
    description: 'Broken-link checker detection mode (M12)',
  })
  @IsOptional()
  @IsIn(BROKEN_LINK_CHECK_MODES)
  brokenLinkCheckMode?: BrokenLinkCheckMode;

  @ApiPropertyOptional({
    minimum: MIN_ARCHIVE_MAX_BYTES,
    maximum: MAX_ARCHIVE_MAX_BYTES,
    description: 'Maximum response size in bytes for per-item page/PDF archiving (M17)',
  })
  @IsOptional()
  @IsInt()
  @Min(MIN_ARCHIVE_MAX_BYTES)
  @Max(MAX_ARCHIVE_MAX_BYTES)
  archiveMaxBytes?: number;
}
