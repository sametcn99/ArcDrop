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
import {
  CollectionDto,
  CollectionIdParamDto,
  CollectionListDto,
  CollectionNodeDto,
  CreateCollectionDto,
  DeleteCollectionQueryDto,
  ReorderCollectionsDto,
  UpdateCollectionDto,
} from './collections.dto';
import { CollectionsService } from './collections.service';

/**
 * Collection surface (plan M4). All routes are bearer-authenticated (global
 * guard) and user-scoped. Static paths (`tree`, `order`) are declared ahead
 * of the `:id` routes so Nest never mistakes them for ids.
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
      'direct membership. Trashed collections are not listed.',
  })
  @ApiOkResponse({ type: CollectionListDto })
  list(@CurrentUser() user: RequestUser): Promise<CollectionListDto> {
    return this.collections.list(user);
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
}
