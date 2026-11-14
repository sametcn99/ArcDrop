import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiAcceptedResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@api/auth/decorators/current-user.decorator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { CollectionsService } from '@api/collections/collections.service';
import {
  BookmarkCollectionsDto,
  ReplaceBookmarkCollectionsDto,
} from '@api/collections/collections.dto';
import {
  BookmarkDto,
  BookmarkIdParamDto,
  BookmarkListDto,
  BookmarkStatsDto,
  CreateBookmarkDto,
  ListBookmarksQueryDto,
  ReplaceBookmarkTagsDto,
  TagUsageDto,
  UpdateBookmarkDto,
} from './bookmarks.dto';
import { BookmarksService } from './bookmarks.service';
import { TagsService } from './tags.service';
import { MetadataFetchService } from '@api/metadata/metadata-fetch.service';
import { ReindexBookmarkResponseDto } from '@api/metadata/metadata.dto';

/**
 * Bookmark surface (plan M3). All routes are bearer-authenticated (global
 * guard) and user-scoped; `GET /bookmarks/tags` and `PUT /bookmarks/{id}/
 * tags` expose the tag views that live under the bookmarks resource, while
 * rename/merge/delete-by-name live on `/tags/{name}`.
 */
@ApiTags('Bookmarks')
@ApiBearerAuth()
@Controller('bookmarks')
export class BookmarksController {
  constructor(
    private readonly bookmarks: BookmarksService,
    private readonly tags: TagsService,
    private readonly collections: CollectionsService,
    private readonly metadata: MetadataFetchService,
  ) {}

  @Post()
  @ApiOperation({
    operationId: 'createBookmark',
    summary: 'Create a bookmark (duplicates of the same URL are allowed)',
    description:
      'Stores the URL verbatim and derives the filterable URL parts server-side ' +
      '(plan D12). Saving the same URL twice creates two bookmarks (plan D13).',
  })
  @ApiCreatedResponse({ type: BookmarkDto })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateBookmarkDto): Promise<BookmarkDto> {
    return this.bookmarks.create(user, dto);
  }

  @Get()
  @ApiOperation({
    operationId: 'listBookmarks',
    summary: 'Search / filter / page the caller’s bookmarks',
    description:
      'Case-insensitive ILIKE search across title, url, excerpt and tag names. ' +
      '`collectionId` matches bookmarks with a membership in that collection ' +
      '(the collection itself may be trashed — membership is membership). ' +
      '`pageSize` above 200 is clamped to 200. Sorted by `updatedAt` desc ' +
      '(default), `createdAt` desc or `title` asc.',
  })
  @ApiOkResponse({ type: BookmarkListDto })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: ListBookmarksQueryDto,
  ): Promise<BookmarkListDto> {
    return this.bookmarks.list(user, query);
  }

  @Get('stats')
  @ApiOperation({
    operationId: 'getBookmarkStats',
    summary: 'Bookmark counts: total, unassigned, trashed',
  })
  @ApiOkResponse({ type: BookmarkStatsDto })
  stats(@CurrentUser() user: RequestUser): Promise<BookmarkStatsDto> {
    return this.bookmarks.stats(user);
  }

  @Get('tags')
  @ApiOperation({
    operationId: 'listBookmarkTags',
    summary: 'The caller’s tags with usage counts',
    description: 'Counts cover ACTIVE (non-trashed) bookmarks, sorted by name.',
  })
  @ApiOkResponse({ type: [TagUsageDto] })
  listTags(@CurrentUser() user: RequestUser): Promise<TagUsageDto[]> {
    return this.tags.listUsage(user.id);
  }

  @Get(':id')
  @ApiOperation({
    operationId: 'getBookmark',
    summary: 'Fetch one bookmark (trashed included — see deletedAt)',
  })
  @ApiOkResponse({ type: BookmarkDto })
  get(@CurrentUser() user: RequestUser, @Param() params: BookmarkIdParamDto): Promise<BookmarkDto> {
    return this.bookmarks.get(user, params.id);
  }

  @Put(':id')
  @ApiOperation({
    operationId: 'updateBookmark',
    summary: 'Update a bookmark (PUT: provided fields replace, null clears)',
    description:
      'Changing `url` re-runs the URL decomposition (plan D12). Refuses trashed bookmarks.',
  })
  @ApiOkResponse({ type: BookmarkDto })
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
    @Body() dto: UpdateBookmarkDto,
  ): Promise<BookmarkDto> {
    return this.bookmarks.update(user, params.id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteBookmark',
    summary: 'Move a bookmark to the trash (soft delete)',
    description: 'Hard deletion happens in the daily retention sweep (plan D17).',
  })
  @ApiNoContentResponse({ description: 'Moved to trash' })
  async delete(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
  ): Promise<void> {
    await this.bookmarks.trash(user, params.id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'restoreBookmark',
    summary: 'Restore a bookmark from the trash',
  })
  @ApiOkResponse({ type: BookmarkDto })
  restore(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
  ): Promise<BookmarkDto> {
    return this.bookmarks.restore(user, params.id);
  }

  @Put(':id/tags')
  @ApiOperation({
    operationId: 'replaceBookmarkTags',
    summary: 'Replace the bookmark’s exact tag set',
    description:
      'Missing tags are created on demand; the previous set is replaced ' +
      'wholesale; tags left without memberships are pruned.',
  })
  @ApiOkResponse({ type: BookmarkDto })
  replaceTags(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
    @Body() dto: ReplaceBookmarkTagsDto,
  ): Promise<BookmarkDto> {
    return this.bookmarks.replaceTags(user, params.id, dto.tags);
  }

  @Put(':id/collections')
  @ApiOperation({
    operationId: 'replaceBookmarkCollections',
    summary: 'Replace the bookmark’s exact collection set (plan D5)',
    description:
      'The bookmark ends up in exactly the listed collections — memberships ' +
      'are ensured for listed ids, removed for absent ones. A bookmark may ' +
      'live in several collections. Every collection whose set actually ' +
      'changed records a `collection:update` on top of the bookmark’s own ' +
      '`bookmark:update`. Refuses trashed bookmarks and unknown/inactive ' +
      'collections (404). Returns the resulting membership set.',
  })
  @ApiOkResponse({ type: BookmarkCollectionsDto })
  replaceCollections(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
    @Body() dto: ReplaceBookmarkCollectionsDto,
  ): Promise<BookmarkCollectionsDto> {
    return this.collections.syncBookmarkCollections(user, params.id, dto.collectionIds);
  }

  @Post(':id/reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    operationId: 'reindexBookmark',
    summary: 'Re-run the metadata/icon pipeline for one bookmark (plan M6)',
    description:
      'Schedules an SSRF-hardened re-scrape in `refresh` mode: coverRef/iconRef ' +
      'are replaced from the page on success; title/excerpt are only filled while ' +
      'still null (client data is never overwritten — clear a field with an ' +
      'explicit null first to have it re-filled). The bookmark is updated ' +
      'asynchronously; completion records a `bookmark:update` change event so ' +
      'devices refetch. Refuses unknown and trashed bookmarks (404). The response ' +
      'is immediate — it says "scheduled", not "done".',
  })
  @ApiAcceptedResponse({
    type: ReindexBookmarkResponseDto,
    description: 'Pipeline scheduled',
  })
  reindex(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
  ): Promise<ReindexBookmarkResponseDto> {
    return this.metadata.reindex(user.id, params.id);
  }
}
