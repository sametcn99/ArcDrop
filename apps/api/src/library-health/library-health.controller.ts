import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type RequestUser } from '@api/auth/decorators/current-user.decorator';
import { DuplicatesService } from './duplicates.service';
import {
  DuplicateGroupsResponseDto,
  ResolveDuplicatesDto,
  ResolveDuplicatesResponseDto,
} from './library-health.dto';

/**
 * Library health surface (plan M12 / D19, parity G10): duplicate detection and
 * explicit transactional resolution. All routes are bearer-authenticated and
 * user-scoped.
 */
@ApiTags('Library Health')
@ApiBearerAuth()
@Controller('library')
export class LibraryHealthController {
  constructor(private readonly duplicates: DuplicatesService) {}

  @Get('duplicates')
  @ApiOperation({
    operationId: 'findDuplicates',
    summary: 'Group active URL bookmarks by normalized URL',
    description:
      'Groups the caller’s non-trashed URL bookmarks that share a normalized URL: ' +
      'same host (ignoring leading `www.`, keeping non-`www.` subdomains and explicit ports), ' +
      'case-sensitive path (ignoring trailing slashes except root `/`), and non-tracking query ' +
      'parameters sorted deterministically (ignoring scheme, fragments, and `utm_*`, `fbclid`, ' +
      '`gclid`, `ref`, `mc_cid`, `mc_eid`). Inside each group of ≥2 bookmarks, the oldest ' +
      '(`createdAt ASC, id ASC`) is `original` and newer copies are `extras`. ' +
      'Saving duplicates remains allowed (plan D13).',
  })
  @ApiOkResponse({ type: DuplicateGroupsResponseDto })
  findDuplicates(@CurrentUser() user: RequestUser): Promise<DuplicateGroupsResponseDto> {
    return this.duplicates.findDuplicates(user.id);
  }

  @Post('duplicates/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'resolveDuplicates',
    summary: 'Merge duplicate tags and collection memberships into keeper and trash extras',
    description:
      'Runs in one change-logged transaction: validates that `keepId` and every id in `trashIds` ' +
      'are active bookmarks owned by the caller (`keepId` not in `trashIds`), copies any missing ' +
      'tags and collection memberships from `trashIds` onto `keepId`, trashes `trashIds` ' +
      '(`deletedAt = now`), and records change events so connected devices converge.',
  })
  @ApiOkResponse({ type: ResolveDuplicatesResponseDto })
  resolveDuplicates(
    @CurrentUser() user: RequestUser,
    @Body() dto: ResolveDuplicatesDto,
  ): Promise<ResolveDuplicatesResponseDto> {
    return this.duplicates.resolveDuplicates(user.id, dto);
  }
}
