import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '@api/auth/decorators/roles.decorator';
import { AuditLogListDto, ListAuditLogsQueryDto } from './audit.dto';
import { AuditService } from './audit.service';

/**
 * Admin audit log read surface (plan M9). Exposes both M7's MCP tool-call
 * audit entries and M9's admin action entries (user management, settings
 * changes). Session-only admin access: `PatScopeGuard` blocks all PATs on
 * `/admin/*` and `RolesGuard` enforces `@Roles('admin')`.
 */
@ApiTags('Audit')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/audit')
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    operationId: 'listAuditLogs',
    summary: 'List admin and MCP tool-call audit entries (paged, filterable)',
    description:
      'Returns entries newest-first (`createdAt DESC, id DESC`). Covers MCP tool calls ' +
      '(`mcp.tools.call`) and admin actions (`admin.user.*`, `admin.settings.*`). ' +
      'Admin session only — regular users and PATs receive 403.',
  })
  @ApiOkResponse({ type: AuditLogListDto })
  list(@Query() query: ListAuditLogsQueryDto): Promise<AuditLogListDto> {
    return this.audit.list(query);
  }
}
