import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@api/auth/decorators/current-user.decorator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import {
  ListNotificationsQueryDto,
  MarkNotificationsReadDto,
  MarkNotificationsReadResponseDto,
  NotificationListDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

/**
 * Durable notification inbox (plan M14 / D20): websocket-only live delivery
 * paired with this REST catch-up surface for offline devices.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    operationId: 'listNotifications',
    summary: 'List notifications in the caller’s inbox (paged)',
    description:
      'Returns reminder notifications from `notification_outbox`, newest first. ' +
      'Filter `unread=true` for offline catch-up. All timestamps are UTC; clients render local time.',
  })
  @ApiOkResponse({ type: NotificationListDto })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListDto> {
    return this.notifications.list(user.id, query);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'markNotificationsRead',
    summary: 'Mark notifications as read (`ids` or `all: true`)',
    description:
      'Transitions unread notifications owned by the caller to read. Idempotent: ' +
      'already-read or unknown IDs are skipped. Returns `{ updated }`.',
  })
  @ApiOkResponse({ type: MarkNotificationsReadResponseDto })
  markRead(
    @CurrentUser() user: RequestUser,
    @Body() dto: MarkNotificationsReadDto,
  ): Promise<MarkNotificationsReadResponseDto> {
    return this.notifications.markRead(user.id, dto);
  }
}
