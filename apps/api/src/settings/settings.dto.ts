import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const BROKEN_LINK_CHECK_MODES = ['off', 'basic', 'default', 'strict'] as const;
export type BrokenLinkCheckMode = (typeof BROKEN_LINK_CHECK_MODES)[number];

/** The runtime instance settings (plan D16; extended M12) with their defaults. */
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
}
