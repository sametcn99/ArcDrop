import { Body, Controller, Delete, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, type RequestUser } from '@api/auth/decorators/current-user.decorator';
import { AccountLifecycleService } from './account-lifecycle.service';
import { ConfirmPasswordDto } from './users.dto';

/**
 * Self-service account lifecycle surface (M15): library reset and account
 * self-delete. Both endpoints require password confirmation, are throttled
 * strictly, and are unreachable via Personal Access Tokens (`PatScopeGuard`).
 */
@ApiTags('Account')
@ApiBearerAuth()
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('me')
export class MeLifecycleController {
  constructor(private readonly lifecycle: AccountLifecycleService) {}

  @Post('reset-data')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'resetOwnData',
    summary:
      'Password-confirmed library reset (wipes bookmarks, collections, tags, highlights, notifications, change events; keeps profile, settings, and sessions)',
  })
  @ApiNoContentResponse({ description: 'Library data wiped and sync sequence reset to 0' })
  resetData(@CurrentUser() user: RequestUser, @Body() dto: ConfirmPasswordDto): Promise<void> {
    return this.lifecycle.resetData(user, dto.password);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteOwnAccount',
    summary:
      'Password-confirmed self-delete (cascades all user data; 409 for the last active admin)',
  })
  @ApiNoContentResponse({ description: 'Account and all owned data deleted' })
  deleteAccount(@CurrentUser() user: RequestUser, @Body() dto: ConfirmPasswordDto): Promise<void> {
    return this.lifecycle.deleteAccount(user, dto.password);
  }
}
