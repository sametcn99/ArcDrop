import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '@api/auth/decorators/current-user.decorator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { FileIdParamDto, GetFileQueryDto } from './files.dto';
import { FilesService } from './files.service';

/**
 * Private user-uploaded file serving (plan M18 / D19).
 *
 * Security contrast with `/api/v1/icons/{id}`:
 * - `/icons/{id}` serves public cached page images/favicons by unguessable capability ref.
 * - `/files/{id}` serves private user-uploaded files and ALWAYS requires bearer
 *   authentication (JWT or PAT) + `userId` ownership check (`404` for other users).
 * - Web/browser clients render private files via authenticated blob fetches (`Authorization` header)
 *   rather than bare `<img src>` tags.
 */
@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get(':id')
  @ApiOperation({
    operationId: 'getFile',
    summary: 'Download or preview an uploaded file (auth required, private user content)',
    description:
      'Accepts either the file bookmark UUID (`id`) or its `fileRef`. Always requires authentication ' +
      'and verifies ownership (`404` for missing, URL-only, or foreign bookmarks — existence is never leaked). ' +
      'Serves inline by default; pass `?download=1` for `Content-Disposition: attachment`. ' +
      'Note: `/files/{id}` is private (unlike public `/icons/{id}`), so browsers render inline previews via authenticated blob fetch.',
  })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({
    schema: { type: 'string', format: 'binary' },
    description: 'The uploaded file bytes',
  })
  async getFile(
    @CurrentUser() user: RequestUser,
    @Param() params: FileIdParamDto,
    @Query() query: GetFileQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const opened = await this.files.openOwnedFile(user, params.id);
    const dispositionKind = query.download ? 'attachment' : 'inline';
    const encodedName = encodeURIComponent(opened.filename);

    response.setHeader('Content-Type', opened.mime);
    response.setHeader(
      'Content-Disposition',
      `${dispositionKind}; filename="${opened.filename}"; filename*=UTF-8''${encodedName}`,
    );
    response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Length', String(opened.size));

    return new StreamableFile(opened.stream);
  }
}
