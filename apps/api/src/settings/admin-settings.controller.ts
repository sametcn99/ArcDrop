import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditService } from '@api/audit/audit.service';
import { CurrentUser, type RequestUser } from '@api/auth/decorators/current-user.decorator';
import { Roles } from '@api/auth/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { SettingsDto, UpdateSettingsDto } from './settings.dto';

/**
 * Admin instance settings (plan D16) — runtime knobs persisted in the
 * `settings` table; changes apply without a restart. Changes are recorded in
 * the admin audit log.
 */
@ApiTags('Settings')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'getInstanceSettings', summary: 'Read the instance settings' })
  @ApiOkResponse({ type: SettingsDto })
  async getSettings(): Promise<SettingsDto> {
    return this.settings.getAll();
  }

  @Put()
  @ApiOperation({
    operationId: 'updateInstanceSettings',
    summary: 'Patch the instance settings (partial update)',
    description:
      'Applies only the provided keys and returns the full updated settings. ' +
      'Effective immediately — no restart required.',
  })
  @ApiOkResponse({ type: SettingsDto })
  async updateSettings(
    @CurrentUser() actor: RequestUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: UpdateSettingsDto,
  ): Promise<SettingsDto> {
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    try {
      const updated = await this.settings.update(dto);
      await this.audit.recordAdminAction({
        actor,
        action: 'admin.settings.update',
        subject: 'instance',
        outcome: 'ok',
        detail: {
          targetType: 'settings',
          changes: { ...dto },
        },
        requestId,
      });
      return updated;
    } catch (error) {
      await this.audit.recordAdminAction({
        actor,
        action: 'admin.settings.update',
        subject: 'instance',
        outcome: 'error',
        detail: {
          targetType: 'settings',
          reason: error instanceof Error ? error.message : 'failed',
        },
        requestId,
      });
      throw error;
    }
  }
}
