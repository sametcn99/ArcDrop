import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Buffer } from 'node:buffer';
import { BookmarkIdParamDto } from '@api/bookmarks/bookmarks.dto';
import { CurrentUser } from '@api/auth/decorators/current-user.decorator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { ExportHighlightsQueryDto } from './portability.dto';
import { PortabilityService } from './portability.service';

/**
 * `GET /bookmarks/{id}/highlights/export` (plan M8/M10, Raindrop parity G4).
 *
 * Lives on the portability module (it is an export route) while exposing
 * the /bookmarks/{id} resource path — a second controller beside
 * `BookmarksController` is what keeps the module graph acyclic (the
 * portability module imports the bookmarks module for its domain
 * services; Nest DI cannot also resolve portability FROM a bookmarks
 * controller).
 */
@ApiTags('Portability')
@ApiBearerAuth()
@Controller('bookmarks')
export class HighlightsExportController {
  constructor(private readonly portability: PortabilityService) {}

  @Get(':id/highlights/export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'exportBookmarkHighlights',
    summary: 'Export a bookmark’s highlights as txt or csv (plan M8/M10, Raindrop parity G4)',
    description:
      'Download: `format=txt` (quoted text blocks with optional `- note:` ' +
      'lines) or `format=csv` (header text,note,color,createdAt). Unknown ' +
      'bookmarks are 404s (trash state included — GET semantics mirror `GET /bookmarks/{id}`).',
  })
  @ApiProduces('text/plain', 'text/csv')
  @ApiOkResponse({
    schema: { type: 'string', format: 'binary' },
    description: 'The highlights download',
  })
  async exportBookmarkHighlights(
    @CurrentUser() user: RequestUser,
    @Param() params: BookmarkIdParamDto,
    @Query() query: ExportHighlightsQueryDto,
  ): Promise<StreamableFile> {
    const download = await this.portability.exportBookmarkHighlights(user, params.id, query.format);
    return new StreamableFile(Buffer.from(download.body, 'utf8'), {
      type: download.contentType,
      disposition: `attachment; filename="${download.filename}"`,
    });
  }
}
