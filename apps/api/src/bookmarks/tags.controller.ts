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
import { RenameTagDto, TagNameParamDto, TagDto } from './bookmarks.dto';
import { TagsService } from './tags.service';

/**
 * Tag management by name (plan M3): rename — or merge when the target name
 * already exists — and delete-with-detach. Names are matched
 * case-insensitively and are URL-encoded in the path.
 */
@ApiTags('Tags')
@ApiBearerAuth()
@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Put(':name')
  @ApiOperation({
    operationId: 'renameTag',
    summary: 'Rename a tag — or merge it when the target name already exists',
    description:
      'Case-insensitive name matching. If no other tag holds `name`, the tag ' +
      'is renamed; if one does, the tags MERGE (memberships re-pointed, the ' +
      'source tag removed) and every affected bookmark records an update.',
  })
  @ApiOkResponse({ type: TagDto, description: 'The surviving tag' })
  rename(
    @CurrentUser() user: RequestUser,
    @Param() params: TagNameParamDto,
    @Body() dto: RenameTagDto,
  ): Promise<TagDto> {
    return this.tags.renameOrMerge(user.id, params.name, dto.name);
  }

  @Delete(':name')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteTag',
    summary: 'Delete a tag and detach it from every bookmark',
  })
  @ApiNoContentResponse({ description: 'Tag deleted everywhere' })
  async delete(@CurrentUser() user: RequestUser, @Param() params: TagNameParamDto): Promise<void> {
    await this.tags.deleteByName(user.id, params.name);
  }
}
