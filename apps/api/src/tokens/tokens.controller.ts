import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@api/auth/decorators/current-user.decorator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import {
  CreatePersonalAccessTokenDto,
  CreatedPersonalAccessTokenDto,
  PersonalAccessTokenIdParamDto,
  PersonalAccessTokenListDto,
} from './tokens.dto';
import { TokensService } from './tokens.service';

/**
 * Personal access tokens (plan M7/D23) — the agent auth path. Long-lived,
 * labeled, revocable, hashed at rest; the raw token is returned EXACTLY
 * ONCE in the create response. Optional `readOnly` scope: mutations are
 * refused at the guard level (REST) / per-tool (MCP).
 */
@ApiTags('Tokens')
@ApiBearerAuth()
@Controller('me/tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Post()
  @ApiOperation({
    operationId: 'createPersonalAccessToken',
    summary: 'Mint a personal access token (the raw token is shown exactly once)',
    description:
      'Creates a long-lived bearer token for agents and other clients that ' +
      'cannot run the refresh-token flow. The raw `token` appears exactly once, ' +
      'in this response — only its sha256 is stored. `readOnly: true` mints a ' +
      'scope=read-only token that can never mutate data.',
  })
  @ApiCreatedResponse({ type: CreatedPersonalAccessTokenDto })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePersonalAccessTokenDto,
  ): Promise<CreatedPersonalAccessTokenDto> {
    return this.tokens.create(user, dto);
  }

  @Get()
  @ApiOperation({
    operationId: 'listPersonalAccessTokens',
    summary: 'The caller’s personal access tokens (never includes the raw token)',
  })
  @ApiOkResponse({ type: PersonalAccessTokenListDto })
  list(@CurrentUser() user: RequestUser): Promise<PersonalAccessTokenListDto> {
    return this.tokens.list(user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'revokePersonalAccessToken',
    summary: 'Revoke a personal access token (immediate; idempotent)',
    description:
      'Stamps `revokedAt` — the token stops authenticating on the very next ' +
      'request (the guard resolves the user per request). Rows are kept for ' +
      'listings; revoking an already-revoked token is a no-op.',
  })
  @ApiNoContentResponse({ description: 'Token revoked' })
  async revoke(
    @CurrentUser() user: RequestUser,
    @Param() params: PersonalAccessTokenIdParamDto,
  ): Promise<void> {
    await this.tokens.revoke(user, params.id);
  }
}
