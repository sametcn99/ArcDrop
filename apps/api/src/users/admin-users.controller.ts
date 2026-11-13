import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
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
 * token to the user out of band.
 */
@ApiTags('Users')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

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
  create(@Body() dto: CreateUserDto): Promise<CreateUserResponseDto> {
    return this.users.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateUser', summary: 'Patch a user role and/or status' })
  @ApiOkResponse({ type: UserDto })
  update(@Param() params: UserIdParamDto, @Body() dto: UpdateUserDto): Promise<UserDto> {
    return this.users.update(params.id, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'resetUserPassword',
    summary: 'Mint a single-use password-reset token for a user',
  })
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  resetPassword(@Param() params: UserIdParamDto): Promise<ResetPasswordResponseDto> {
    return this.users.requestPasswordReset(params.id);
  }
}
