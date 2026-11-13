import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  AuthSessionResponseDto,
  BootstrapDto,
  ChangePasswordDto,
  ClaimDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  SessionDto,
  SessionIdParamDto,
  UserDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import { CurrentUser, type RequestUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';

/**
 * Authentication surface (plan D2/D3/D15). All routes are throttled strictly
 * (10 req/min per IP — the global default is 100/min) because every one of
 * them either verifies credentials or mints tokens.
 *
 * Route map:
 * - public:  bootstrap, login, refresh, logout, claim, register
 * - bearer:  me, password, sessions, sessions/{id}
 */
@ApiTags('Auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** First-run admin creation; 409 once any user exists (plan D3). */
  @Public()
  @Post('bootstrap')
  @ApiOperation({
    operationId: 'bootstrapInstance',
    summary: 'Create the first admin user (only while the instance has none)',
  })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  bootstrap(@Body() dto: BootstrapDto, @Req() request: Request): Promise<AuthSessionResponseDto> {
    return this.auth.bootstrap(dto, resolveDeviceLabel(dto, request));
  }

  @Public()
  @Post('login')
  @ApiOperation({
    operationId: 'login',
    summary: 'Email + password login → access JWT + rotating refresh token',
  })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  login(@Body() dto: LoginDto, @Req() request: Request): Promise<AuthSessionResponseDto> {
    return this.auth.login(dto, resolveDeviceLabel(dto, request));
  }

  /** Rotates the refresh token; reuse revokes the whole family (plan D2). */
  @Public()
  @Post('refresh')
  @ApiOperation({
    operationId: 'refreshTokens',
    summary: 'Exchange a refresh token for a fresh token pair',
    description:
      'The presented token is rotated (revoked and replaced within its family). ' +
      'Replaying an already-rotated token revokes the entire family.',
  })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  refresh(@Body() dto: RefreshDto): Promise<AuthSessionResponseDto> {
    return this.auth.refresh(dto);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'logout',
    summary: 'Revoke the presented refresh token (idempotent)',
  })
  @ApiNoContentResponse()
  logout(@Body() dto: LogoutDto): Promise<void> {
    return this.auth.logout(dto);
  }

  /** Consumes a single-use invite/reset token and sets the password (D15). */
  @Public()
  @Post('claim')
  @ApiOperation({
    operationId: 'claimToken',
    summary: 'Consume an invite/reset token, set the password, start a session',
  })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  claim(@Body() dto: ClaimDto, @Req() request: Request): Promise<AuthSessionResponseDto> {
    return this.auth.claim(dto, resolveDeviceLabel(dto, request));
  }

  /** Exists always; 403 while the registration setting is off (D3/D16). */
  @Public()
  @Post('register')
  @ApiOperation({
    operationId: 'register',
    summary: 'Open registration — only while the instance setting is on',
  })
  @ApiCreatedResponse({ type: AuthSessionResponseDto })
  register(@Body() dto: RegisterDto, @Req() request: Request): Promise<AuthSessionResponseDto> {
    return this.auth.register(dto, resolveDeviceLabel(dto, request));
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'getCurrentUser', summary: 'The authenticated user' })
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser() user: RequestUser): UserDto {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      hasPassword: true,
      createdAt: user.createdAt,
    };
  }

  @Post('password')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    operationId: 'changeOwnPassword',
    summary: 'Change own password (revokes other sessions)',
  })
  @ApiNoContentResponse()
  changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto): Promise<void> {
    return this.auth.changePassword(user, dto);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({
    operationId: 'listSessions',
    summary: 'List the authenticated user sessions (refresh-token families)',
  })
  @ApiOkResponse({ type: [SessionDto] })
  listSessions(@CurrentUser() user: RequestUser): Promise<SessionDto[]> {
    return this.auth.listSessions(user);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    operationId: 'revokeSession',
    summary: 'Revoke one session (family) by id',
  })
  @ApiNoContentResponse()
  async revokeSession(
    @CurrentUser() user: RequestUser,
    @Param() params: SessionIdParamDto,
  ): Promise<void> {
    await this.auth.revokeSession(user, params.id);
  }
}

/**
 * Client-provided label, else the User-Agent, else a placeholder — stored
 * with the session so `/auth/sessions` reads like a device list.
 */
function resolveDeviceLabel(dto: { deviceLabel?: string }, request: Request): string {
  const provided = dto.deviceLabel?.trim();
  if (provided) return provided.slice(0, 200);
  const userAgent = request.headers['user-agent'];
  if (typeof userAgent === 'string' && userAgent.length > 0) return userAgent.slice(0, 200);
  return 'unknown device';
}
