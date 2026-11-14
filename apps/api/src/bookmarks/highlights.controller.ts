import { Body, Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@api/auth/decorators/current-user.decorator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { HighlightDto, HighlightIdParamDto, UpdateHighlightDto } from './bookmarks.dto';
import { HighlightsService } from './highlights.service';

/**
 * Top-level highlight mutations (`/highlights/{id}`, plan D6, M10).
 * Listing and creating highlights live on `/bookmarks/{id}/highlights` in
 * `BookmarksController`.
 */
@ApiTags('Highlights')
@ApiBearerAuth()
@Controller('highlights')
export class HighlightsController {
  constructor(private readonly highlights: HighlightsService) {}

  @Put(':id')
  @ApiOperation({
    operationId: 'updateHighlight',
    summary: 'Update a highlight (text, note, color)',
    description:
      'PUT semantics: provided fields replace, explicit `null` clears `note`/`color`. ' +
      'Refuses highlights on unknown or trashed bookmarks (404).',
  })
  @ApiOkResponse({ type: HighlightDto })
  update(
    @CurrentUser() user: RequestUser,
    @Param() params: HighlightIdParamDto,
    @Body() dto: UpdateHighlightDto,
  ): Promise<HighlightDto> {
    return this.highlights.update(user, params.id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteHighlight',
    summary: 'Delete a highlight',
    description: 'Hard-deletes the highlight and records a `highlight:delete` change event.',
  })
  @ApiNoContentResponse({ description: 'Highlight deleted' })
  async delete(
    @CurrentUser() user: RequestUser,
    @Param() params: HighlightIdParamDto,
  ): Promise<void> {
    await this.highlights.delete(user, params.id);
  }
}
