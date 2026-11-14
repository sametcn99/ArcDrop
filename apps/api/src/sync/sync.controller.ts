import { Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@api/auth/decorators/current-user.decorator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { GetSyncChangesQueryDto, SyncChangesDto, SyncStateDto, SyncTicketDto } from './sync.dto';
import { SyncService } from './sync.service';
import { SyncTicketService } from './sync-ticket.service';

/**
 * Sync surface (plan M5, D4). The change log exposed as the multi-device
 * backbone: `GET /sync/state` is the cheap poll, `GET /sync/changes` is
 * the cursor-based delta (the source of truth), and `POST /sync/ticket`
 * mints the one-time credential for the ws push channel (`/api/v1/sync/ws`).
 *
 * All routes are bearer-authenticated (global guard) and user-scoped; seq
 * values travel as decimal strings everywhere (pg bigint).
 */
@ApiTags('Sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(
    private readonly sync: SyncService,
    private readonly tickets: SyncTicketService,
  ) {}

  @Get('state')
  @ApiOperation({
    operationId: 'getSyncState',
    summary: 'The caller’s current change-log seq (cheap poll)',
    description:
      'Compare against your persisted cursor to decide whether pulling ' +
      '`GET /sync/changes` is worth a round trip.',
  })
  @ApiOkResponse({ type: SyncStateDto })
  getState(@CurrentUser() user: RequestUser): Promise<SyncStateDto> {
    return this.sync.getState(user.id);
  }

  @Get('changes')
  @ApiOperation({
    operationId: 'listSyncChanges',
    summary: 'Cursor-based delta: events since a seq, with entity snapshots',
    description:
      'Returns events in seq order (ascending, gapless per user) joined with ' +
      'the entity’s CURRENT row for create/update — bookmark snapshots reuse ' +
      'the BookmarkDto shape — and a null snapshot (tombstone) for delete. ' +
      'The response carries the next cursor. When `since` predates the oldest ' +
      'retained event (log compaction), `resyncRequired` is true, `changes` is ' +
      'empty and the client must refetch its lists (GET /bookmarks, ' +
      'GET /collections) and adopt the returned cursor.',
  })
  @ApiOkResponse({ type: SyncChangesDto })
  listChanges(
    @CurrentUser() user: RequestUser,
    @Query() query: GetSyncChangesQueryDto,
  ): Promise<SyncChangesDto> {
    return this.sync.getChanges(user.id, query.since, query.limit);
  }

  @Post('ticket')
  @ApiOperation({
    operationId: 'createSyncTicket',
    summary: 'Mint a one-time websocket ticket (single use, 60s)',
    description:
      'Present the ticket on the ws handshake as the `ticket` query parameter ' +
      'of `/api/v1/sync/ws` (browsers cannot send Authorization headers on ' +
      'websocket requests). A ticket redeems exactly once; expired, unknown ' +
      'or replayed tickets are refused with ws close code 1008.',
  })
  @ApiCreatedResponse({ type: SyncTicketDto })
  createTicket(@CurrentUser() user: RequestUser): SyncTicketDto {
    return this.tickets.issue(user.id);
  }
}
