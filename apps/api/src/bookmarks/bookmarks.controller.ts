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
  UseGuards,
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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CurrentUser } from '@api/auth/decorators/current-user.decorator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { UserRateLimit } from '@api/common/rate-limit/user-rate-limit.decorator';
import { UserRateLimitGuard } from '@api/common/rate-limit/user-rate-limit.guard';
import { validationExceptionFactory } from '@api/common/validation';
import { CollectionsService } from '@api/collections/collections.service';
import {
  BookmarkCollectionsDto,
  ReplaceBookmarkCollectionsDto,
} from '@api/collections/collections.dto';
import {
  BookmarkArchiveDto,
  BookmarkDto,
  BookmarkIdParamDto,
  BookmarkListDto,
  BookmarkStatsDto,
  BulkBookmarksDto,
  BulkBookmarksResponseDto,
  CreateBookmarkBodyDto,
  CreateBookmarkDto,
  CreateHighlightDto,
  HighlightDto,
  HighlightListDto,
  ListBookmarksQueryDto,
  QuickAddBookmarkQueryDto,
  ReplaceBookmarkTagsDto,
  TagUsageDto,
  UpdateBookmarkDto,
} from './bookmarks.dto';
import { BookmarksService } from './bookmarks.service';
import { BulkBookmarksService } from './bulk-bookmarks.service';
import { HighlightsService } from './highlights.service';
import { TagsService } from './tags.service';
import { MetadataFetchService } from '@api/metadata/metadata-fetch.service';
import { ReindexBookmarkResponseDto } from '@api/metadata/metadata.dto';

/**
 * Bookmark surface (plan M3, extended M10/M11/M12/M13/M14/M16/M17). All
 * routes are bearer-authenticated (global guard) and user-scoped;
 * `GET /bookmarks/tags` and `PUT /bookmarks/{id}/tags` expose tags,
 * `GET/POST /bookmarks/{id}/highlights` expose highlights,
 * `GET /bookmarks/{id}/archive` serves extracted permanent archive copies, and
 * `POST /bookmarks/bulk` executes transactional bulk ops.
 */
@ApiTags('Bookmarks')
@ApiBearerAuth()
@Controller('bookmarks')
export class BookmarksController {
  constructor(
    private readonly bookmarks: BookmarksService,
    private readonly bulk: BulkBookmarksService,
    private readonly tags: TagsService,
    private readonly highlights: HighlightsService,
    private readonly collections: CollectionsService,
    private readonly metadata: MetadataFetchService,
  ) {}

  @Post()
  @ApiOperation({
    operationId: 'createBookmark',
    summary: 'Create a bookmark (JSON body or quick-add query params)',
    description:
      'Stores the URL verbatim and derives the filterable URL parts server-side ' +
      '(plan D12). Saving the same URL twice creates two bookmarks (plan D13). ' +
      'Supports quick-add query params (`?url=…&title=…&collection=…`) for RSS readers ' +
      'and share sheets using the same validation and metadata/archive pipeline. ' +
      'When `collection` is supplied, the new membership appends at `MAX(order) + 1`. ' +
      'Optional `reminderAt` is stored in UTC (clients render local time).',
  })
  @ApiCreatedResponse({ type: BookmarkDto })
  async create(
    @CurrentUser() user: RequestUser,
    @Body() body: CreateBookmarkBodyDto,
    @Query() query: QuickAddBookmarkQueryDto,
  ): Promise<BookmarkDto> {
    const merged = {
      url: body.url ?? query.url,
      title: body.title !== undefined ? body.title : query.title,
      excerpt: body.excerpt !== undefined ? body.excerpt : query.excerpt,
      note: body.note !== undefined ? body.note : query.note,
      favorite: body.favorite !== undefined ? body.favorite : query.favorite,
      reminderAt: body.reminderAt,
    };
    const dto = plainToInstance(CreateBookmarkDto, merged);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length > 0) {
      throw validationExceptionFactory(errors);
    }
    return this.bookmarks.create(user, dto, query.collection);
  }

  @Get()
  @ApiOperation({
    operationId: 'listBookmarks',
    summary: 'Search / filter / page the caller’s bookmarks',
    description:
      'Searches and filters bookmarks. The `search` (or alias `q`) query parameter parses ' +
      'the canonical M11/M12/M14/M17 operator grammar: plain `word` / `"exact phrase"` ' +
      '(hybrid PostgreSQL `simple`-config FTS across title, excerpt, note, extracted page/PDF archive content, and highlights, plus prefix `:*` and ILIKE fallback for URLs, tag names, and short/punctuation tokens), ' +
      '`-word` / `-"phrase"` exclusions, `#tag` / `-#tag` / `#"multi word tag"` / `-#"multi word tag"`, ' +
      'field-scoped `title:`, `excerpt:`, `note:`, `link:` (negatable), ' +
      '`type:<article|image|video|audio|document|book|link>`, `cache.status:<pending|ready|failed|invalid-origin|skipped>`, ' +
      '`favorite:true|false`, `notag:true|false`, ' +
      '`broken:true|false`, `reminder:true|false`, `created:` / `lastUpdate:` with `[<|>|<=|>=]YYYY[-MM[-DD]]` (UTC), and `match:OR` ' +
      '(OR positive terms; exclusions stay ANDed). Reserved operators (`file:`) ' +
      'and unknown operators return `400 BAD_REQUEST` with character position. ' +
      'Composes with `collectionId` (membership is membership), `tag`, `domain`, `favorite`, `broken`, `reminder`, `type`, `cacheStatus`, ' +
      '`unassignedOnly`, `trashed`, and `updatedSince` via AND. ' +
      '`pageSize` above 200 is clamped to 200. Sorted by `updatedAt` desc (default), `createdAt` desc, `title` asc, ' +
      'or `manual` (membership `order` asc NULLS LAST; requires `collectionId` because manual order is membership-scoped per collection per D21 — returns `400 BAD_REQUEST` without `collectionId`).',
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
    summary: 'Bookmark counts: total, unassigned, trashed, favorites',
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

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit('bulk')
  @ApiOperation({
    operationId: 'bulkBookmarks',
    summary: 'Run a transactional bulk operation over bookmarks (max 500 ids)',
    description:
      'Executes `move` (`assign` | `union` collection memberships; new memberships append at `MAX(order) + 1`), `addTags`, ' +
      '`removeTags`, `trash`, `restore`, or `delete` (hard delete strictly for ' +
      'already-trashed ids, preserving M4 two-phase semantics) in a single ' +
      'change-logged transaction. Any invalid/missing id or state conflict rolls ' +
      'back the entire batch with zero partial writes or change events. ' +
      'Per-user rate limit: 30/min (configurable).',
  })
  @ApiOkResponse({ type: BulkBookmarksResponseDto })
  bulkOperate(
    @CurrentUser() user: RequestUser,
    @Body() dto: BulkBookmarksDto,
  ): Promise<BulkBookmarksResponseDto> {
    return this.bulk.execute(user, dto);
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

  @Get(':id/archive')
  @ApiOperation({
    operationId: 'getBookmarkArchive',
    summary:
      'Fetch the permanent archived copy (sanitized HTML + plain text) of one bookmark (M17)',
    description:
      'Returns the extracted readable HTML and indexed plain text stored on the archive volume ' +
      'when `cacheStatus` is `ready`. Returns `404 NOT_FOUND` if the bookmark does not exist or has no ready archive.',
  })
  @ApiOkResponse({ type: BookmarkArchiveDto })
  getArchive(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
  ): Promise<BookmarkArchiveDto> {
    return this.bookmarks.getArchive(user, params.id);
  }

  @Put(':id')
  @ApiOperation({
    operationId: 'updateBookmark',
    summary: 'Update a bookmark (PUT: provided fields replace, null clears)',
    description:
      'Changing `url` re-runs the URL decomposition (plan D12), clears any broken-link flag (M12), and resets archive state to pending (M17). ' +
      'Setting `reminderAt` schedules a one-time reminder in UTC (clients render local time; explicit `null` cancels it). ' +
      'Refuses trashed bookmarks.',
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
    description:
      'Soft-deletes the bookmark (`deletedAt` set) while preserving its collection memberships and manual `order` slots ' +
      '(restoring returns it to the same slots). Hard deletion (purge) happens in the daily retention sweep (plan D17) or bulk delete and removes membership rows, slots, and archived bytes.',
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
    description:
      'Restores a trashed bookmark to the active set; preserved collection memberships keep their prior manual `order` slots.',
  })
  @ApiOkResponse({ type: BookmarkDto })
  restore(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
  ): Promise<BookmarkDto> {
    return this.bookmarks.restore(user, params.id);
  }

  @Get(':id/highlights')
  @ApiOperation({
    operationId: 'listHighlights',
    summary: 'List a bookmark’s highlights (trashed bookmarks included)',
  })
  @ApiOkResponse({ type: HighlightListDto })
  listHighlights(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
  ): Promise<HighlightListDto> {
    return this.highlights.list(user, params.id);
  }

  @Post(':id/highlights')
  @ApiOperation({
    operationId: 'createHighlight',
    summary: 'Add a highlight to a bookmark (plan D6)',
    description: 'Refuses trashed or unknown bookmarks (404). Records a `highlight:create` event.',
  })
  @ApiCreatedResponse({ type: HighlightDto })
  createHighlight(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
    @Body() dto: CreateHighlightDto,
  ): Promise<HighlightDto> {
    return this.highlights.create(user, params.id, dto);
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
      'The bookmark ends up in exactly the listed collections — existing memberships ' +
      'keep their manual `order` slots, newly added memberships append at `MAX(order) + 1`, ' +
      'and absent ones are removed. A bookmark may live in several collections with ' +
      'independent manual order slots per collection (plan D21). Every collection whose set actually ' +
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
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit('reindex')
  @ApiOperation({
    operationId: 'reindexBookmark',
    summary:
      'Re-run the metadata, icon, and permanent archive pipeline for one bookmark (plan M6/M17)',
    description:
      'Schedules an SSRF-hardened re-scrape in `refresh` mode: coverRef/iconRef, ' +
      'contentType, and the archived HTML/plain-text copy + FTS text are re-extracted from the target on success; ' +
      'title/excerpt are only filled while still null (client data is never overwritten — clear a field with an ' +
      'explicit null first to have it re-filled). The bookmark is updated ' +
      'asynchronously; completion records a `bookmark:update` change event so ' +
      'devices refetch. Refuses unknown and trashed bookmarks (404). The response ' +
      'is immediate — it says "scheduled", not "done". Per-user rate limit: ' +
      '30/min (configurable).',
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
