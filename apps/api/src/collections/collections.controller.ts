import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { UserRateLimit } from '@api/common/rate-limit/user-rate-limit.decorator';
import { UserRateLimitGuard } from '@api/common/rate-limit/user-rate-limit.guard';
import {
  CollectionDto,
  CollectionIdParamDto,
  CollectionListDto,
  CollectionNodeDto,
  CollectionShareResponseDto,
  CreateCollectionDto,
  DeleteCollectionQueryDto,
  DeleteEmptyCollectionsResponseDto,
  ListCollectionsQueryDto,
  MergeCollectionsDto,
  MergeCollectionsResponseDto,
  ReorderCollectionBookmarksDto,
  ReorderCollectionsDto,
  SortCollectionsResponseDto,
  UpdateCollectionDto,
  UpdateCollectionShareDto,
} from './collections.dto';
import { CollectionsService } from './collections.service';

/**
 * Collection surface (plan M4, extended M13/M16/M19). All routes are bearer-authenticated
 * (global guard) and user-scoped. Static paths (`tree`, `order`, `merge`,
 * `sort-alphabetical`, `delete-empty`) are declared ahead of the `:id` routes
 * so Nest never mistakes them for ids.
 */
@ApiTags('Collections')
@ApiBearerAuth()
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @ApiOperation({
    operationId: 'listCollections',
    summary: 'Flat rows of the caller’s collections (active only)',
    description:
      'Grouped per parent (roots first); siblings ordered by `order`, then ' +
      '`createdAt`, then `id`. `bookmarkCount` covers ACTIVE bookmarks with a ' +
      'direct membership. Trashed collections are not listed. Optional `shared` ' +
      'query filters by public sharing state (`true` or `false`).',
  })
  @ApiOkResponse({ type: CollectionListDto })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListCollectionsQueryDto,
  ): Promise<CollectionListDto> {
    return this.collections.list(user, query);
  }

  @Get('tree')
  @ApiOperation({
    operationId: 'getCollectionTree',
    summary: 'The caller’s collections as a nested tree with bookmark counts',
    description:
      'Counts are DIRECT (a parent does not add its subtree’s counts on) and ' +
      'cover ACTIVE bookmarks only. A child whose parent is trashed is ' +
      'promoted to the root level so restored subtrees never disappear.',
  })
  @ApiOkResponse({ type: [CollectionNodeDto] })
  tree(@CurrentUser() user: RequestUser): Promise<CollectionNodeDto[]> {
    return this.collections.tree(user);
  }

  @Post()
  @ApiOperation({
    operationId: 'createCollection',
    summary: 'Create a root collection — or a child when parentId is set',
    description:
      'The new collection appends to the end of its sibling group ' +
      '(MAX(order) + 1 among active siblings).',
  })
  @ApiCreatedResponse({ type: CollectionDto })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCollectionDto,
  ): Promise<CollectionDto> {
    return this.collections.create(user, dto);
  }

  @Patch('order')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'reorderCollections',
    summary: 'Set explicit sibling positions',
    description:
      'Assigns `order` for the listed collections; unspecified siblings keep ' +
      'their positions. Rows whose position does not change record no change ' +
      'event. Trashed collections are refused.',
  })
  @ApiNoContentResponse({ description: 'Positions applied' })
  async reorder(
    @CurrentUser() user: RequestUser,
    @Body() dto: ReorderCollectionsDto,
  ): Promise<void> {
    await this.collections.reorder(user, dto);
  }

  @Post('merge')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit('bulk')
  @ApiOperation({
    operationId: 'mergeCollections',
    summary: 'Merge source collections into a target collection in one transaction',
    description:
      'Reparents non-source direct children and moves all bookmark memberships from ' +
      '`sourceIds` into `targetId`, then soft-trashes `sourceIds`. Refuses if `targetId` ' +
      'is in `sourceIds` (400) or is a descendant of any source collection (409). ' +
      'Per-user rate limit: 30/min (configurable).',
  })
  @ApiOkResponse({ type: MergeCollectionsResponseDto })
  merge(
    @CurrentUser() user: RequestUser,
    @Body() dto: MergeCollectionsDto,
  ): Promise<MergeCollectionsResponseDto> {
    return this.collections.merge(user, dto);
  }

  @Post('sort-alphabetical')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit('bulk')
  @ApiOperation({
    operationId: 'sortCollectionsAlphabetical',
    summary: 'Reorder every sibling level alphabetically by title',
    description:
      'Sorts roots and every nested parent level alphabetically in a single transaction. ' +
      'Only collections whose `order` actually changes are updated and change-logged. ' +
      'Per-user rate limit: 30/min (configurable).',
  })
  @ApiOkResponse({ type: SortCollectionsResponseDto })
  sortAlphabetical(@CurrentUser() user: RequestUser): Promise<SortCollectionsResponseDto> {
    return this.collections.sortAlphabetical(user);
  }

  @Post('delete-empty')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit('bulk')
  @ApiOperation({
    operationId: 'deleteEmptyCollections',
    summary: 'Trash every collection with no non-trashed bookmarks anywhere in its subtree',
    description:
      'Recursively identifies active collections whose entire active subtree holds zero ' +
      'active (non-trashed) bookmarks, soft-trashes them in one change-logged transaction, ' +
      'and reports `{ trashed, kept }`. Per-user rate limit: 30/min (configurable).',
  })
  @ApiOkResponse({ type: DeleteEmptyCollectionsResponseDto })
  deleteEmpty(@CurrentUser() user: RequestUser): Promise<DeleteEmptyCollectionsResponseDto> {
    return this.collections.deleteEmpty(user);
  }

  @Get(':id')
  @ApiOperation({
    operationId: 'getCollection',
    summary: 'Fetch one active collection (trashed rows are 404)',
  })
  @ApiOkResponse({ type: CollectionDto })
  get(
    @CurrentUser() user: RequestUser,
    @Param() params: CollectionIdParamDto,
  ): Promise<CollectionDto> {
    return this.collections.get(user, params.id);
  }

  @Put(':id')
  @ApiOperation({
    operationId: 'updateCollection',
    summary: 'Update metadata and/or move the collection (PUT semantics)',
    description:
      'Provided fields replace; `icon`/`color` accept explicit null to clear; ' +
      '`parentId: null` moves to the root level. Moving the collection under ' +
      'one of its own descendants fails with 409 (cycle protection). ' +
      'Refuses trashed collections.',
  })
  @ApiOkResponse({ type: CollectionDto })
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: CollectionIdParamDto,
    @Body() dto: UpdateCollectionDto,
  ): Promise<CollectionDto> {
    return this.collections.update(user, params.id, dto);
  }

  @Put(':id/share')
  @ApiOperation({
    operationId: 'updateCollectionShare',
    summary: 'Enable or disable unauthenticated public sharing and RSS for a collection (M19)',
    description:
      'When `enabled: true`, preserves an existing token or mints a fresh 192-bit token ' +
      'and returns the public JSON and RSS URL paths. When `enabled: false`, immediately ' +
      'revokes public access and clears the token so re-enabling rotates to a new link. ' +
      'Active nested child collections are included automatically.',
  })
  @ApiOkResponse({ type: CollectionShareResponseDto })
  setShare(
    @CurrentUser() user: RequestUser,
    @Param() params: CollectionIdParamDto,
    @Body() dto: UpdateCollectionShareDto,
  ): Promise<CollectionShareResponseDto> {
    return this.collections.setShare(user, params.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'deleteCollection',
    summary: 'Trash a collection — hard delete on the second call',
    description:
      'First call: soft delete (trash). Blocked with 409 while active child ' +
      'collections exist unless `?cascade=trash`, which trashes the whole ' +
      'active subtree plus every active bookmark in it. Second call on the ' +
      'trashed id: hard delete (tombstone). Hard delete refuses active ' +
      'descendants even with `?cascade=trash` and never deletes bookmark ' +
      'rows — only their memberships die.',
  })
  @ApiNoContentResponse({ description: 'Trashed (first call) / hard-deleted (second call)' })
  async delete(
    @CurrentUser() user: RequestUser,
    @Param() params: CollectionIdParamDto,
    @Query() query: DeleteCollectionQueryDto,
  ): Promise<void> {
    await this.collections.delete(user, params.id, query.cascade === 'trash');
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'restoreCollection',
    summary: 'Restore a trashed collection',
    description:
      'Restores EXACTLY this row — cascade-trashed descendants and their ' +
      'bookmarks stay in the trash until individually restored (or purged). ' +
      'Until the parent is restored too, the collection appears at the root ' +
      'level of the tree.',
  })
  @ApiOkResponse({ type: CollectionDto })
  restore(
    @CurrentUser() user: RequestUser,
    @Param() params: CollectionIdParamDto,
  ): Promise<CollectionDto> {
    return this.collections.restore(user, params.id);
  }

  @Patch(':id/bookmarks/order')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'reorderCollectionBookmarks',
    summary: 'Set explicit manual positions for bookmarks inside one collection (plan D21)',
    description:
      'Assigns `order` on the membership rows (`bookmark_collections`) for the ' +
      'listed bookmarks inside `{id}`; unspecified members keep their existing ' +
      'positions. Order is membership-scoped per collection (plan D21), so a ' +
      'bookmark belonging to multiple collections maintains an independent slot in ' +
      'each. Refuses duplicate ids (400), trashed/unknown collections (404), and ' +
      'trashed or non-member bookmarks (404). Touched memberships record ' +
      '`bookmark:update` change events without bumping `bookmarks.updatedAt`.',
  })
  @ApiNoContentResponse({ description: 'Positions applied' })
  async reorderBookmarks(
    @CurrentUser() user: RequestUser,
    @Param() params: CollectionIdParamDto,
    @Body() dto: ReorderCollectionBookmarksDto,
  ): Promise<void> {
    await this.collections.reorderBookmarks(user, params.id, dto);
  }
}
