import { Controller, Get, Put, Body } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '@api/auth/decorators/roles.decorator';
import { SettingsService } from './settings.service';
import { SettingsDto, UpdateSettingsDto } from './settings.dto';

/**
 * Admin instance settings (plan D16) — runtime knobs persisted in the
 * `settings` table; changes apply without a restart.
 */
@ApiTags('Settings')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

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
  async updateSettings(@Body() dto: UpdateSettingsDto): Promise<SettingsDto> {
    return this.settings.update(dto);
  }
}
