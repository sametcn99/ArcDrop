import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/** The runtime instance settings (plan D16) with their defaults. */
export class SettingsDto {
  @ApiProperty({ description: 'Whether POST /auth/register creates accounts (plan D3)' })
  registrationOpen!: boolean;

  @ApiProperty({ description: 'Trash auto-purge window in days (plan D17)' })
  trashRetentionDays!: number;

  @ApiProperty({ description: 'Change-log retention window in days (plan D4)' })
  changeLogRetentionDays!: number;
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
}
