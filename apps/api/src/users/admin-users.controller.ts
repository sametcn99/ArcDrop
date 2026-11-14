import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AuditService } from '@api/audit/audit.service';
import { CurrentUser, type RequestUser } from '@api/auth/decorators/current-user.decorator';
import { Roles } from '@api/auth/decorators/roles.decorator';
import { UserDto } from '@api/auth/auth.dto';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  CreateUserResponseDto,
  ResetPasswordResponseDto,
  UpdateUserDto,
  UserIdParamDto,
} from './users.dto';

/**
 * Admin user management (plan D3/D15). Invite/reset tokens are returned in
 * these response bodies ONLY — there is no SMTP in v1; the admin hands the
 * token to the user out of band. Mutations are recorded in the admin audit log.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listUsers', summary: 'List all users' })
  @ApiOkResponse({ type: [UserDto] })
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  @Post()
  @ApiOperation({
    operationId: 'createUser',
    summary: 'Create a user; the response carries their single-use invite token',
  })
  @ApiCreatedResponse({ type: CreateUserResponseDto })
  async create(
    @CurrentUser() actor: RequestUser,
    @Req() req: Request & { id?: unknown },
    @Body() dto: CreateUserDto,
  ): Promise<CreateUserResponseDto> {
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    try {
      const result = await this.users.create(dto);
      await this.audit.recordAdminAction({
        actor,
        action: 'admin.user.create',
        subject: result.user.id,
        outcome: 'ok',
        // Never persist the single-use invite token in audit detail.
        detail: {
          targetType: 'user',
          targetId: result.user.id,
          email: result.user.email,
          role: result.user.role,
        },
        requestId,
      });
      return result;
    } catch (error) {
      await this.audit.recordAdminAction({
        actor,
        action: 'admin.user.create',
        subject: null,
        outcome: 'error',
        detail: {
          targetType: 'user',
          email: dto.email.trim().toLowerCase(),
          reason: error instanceof Error ? error.message : 'failed',
        },
        requestId,
      });
      throw error;
    }
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateUser', summary: 'Patch a user role and/or status' })
  @ApiOkResponse({ type: UserDto })
  async update(
    @CurrentUser() actor: RequestUser,
    @Req() req: Request & { id?: unknown },
    @Param() params: UserIdParamDto,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDto> {
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    try {
      const updated = await this.users.update(params.id, dto);
      await this.audit.recordAdminAction({
        actor,
        action: 'admin.user.update',
        subject: updated.id,
        outcome: 'ok',
        detail: {
          targetType: 'user',
          targetId: updated.id,
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
        requestId,
      });
      return updated;
    } catch (error) {
      await this.audit.recordAdminAction({
        actor,
        action: 'admin.user.update',
        subject: params.id,
        outcome: 'error',
        detail: {
          targetType: 'user',
          targetId: params.id,
          reason: error instanceof Error ? error.message : 'failed',
        },
        requestId,
      });
      throw error;
    }
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'resetUserPassword',
    summary: 'Mint a single-use password-reset token for a user',
  })
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  async resetPassword(
    @CurrentUser() actor: RequestUser,
    @Req() req: Request & { id?: unknown },
    @Param() params: UserIdParamDto,
  ): Promise<ResetPasswordResponseDto> {
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    try {
      const result = await this.users.requestPasswordReset(params.id);
      await this.audit.recordAdminAction({
        actor,
        action: 'admin.user.reset_password',
        subject: params.id,
        outcome: 'ok',
        // Never persist the single-use reset token in audit detail.
        detail: {
          targetType: 'user',
          targetId: params.id,
        },
        requestId,
      });
      return result;
    } catch (error) {
      await this.audit.recordAdminAction({
        actor,
        action: 'admin.user.reset_password',
        subject: params.id,
        outcome: 'error',
        detail: {
          targetType: 'user',
          targetId: params.id,
          reason: error instanceof Error ? error.message : 'failed',
        },
        requestId,
      });
      throw error;
    }
  }
}
