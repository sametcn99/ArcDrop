import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Readable } from 'node:stream';
import { CurrentUser } from '@api/auth/decorators/current-user.decorator';
import type { RequestUser } from '@api/auth/decorators/current-user.decorator';
import { UserRateLimit } from '@api/common/rate-limit/user-rate-limit.decorator';
import { UserRateLimitGuard } from '@api/common/rate-limit/user-rate-limit.guard';
import { ExportDataDto, ImportSummaryDto } from './portability.dto';
import { PortabilityService, type ExportScope } from './portability.service';
import {
  ImportFile,
  ImportUploadInterceptor,
  type ImportFilePayload,
} from './import-upload.interceptor';

/** Format → (content type, download file name). */
const EXPORT_MEDIA: Record<ExportDataDto['format'], { contentType: string; extension: string }> = {
  json: { contentType: 'application/json; charset=utf-8', extension: 'json' },
  csv: { contentType: 'text/csv; charset=utf-8', extension: 'csv' },
  html: { contentType: 'text/html; charset=utf-8', extension: 'html' },
  txt: { contentType: 'text/plain; charset=utf-8', extension: 'txt' },
};

/**
 * Portability surface (plan M8): `POST /data/export` streams the library
 * out, `POST /data/import` ingests a multipart upload with a URL-keyed
 * upsert summary. The per-bookmark highlights export lives on the
 * bookmarks controller (it is a /bookmarks/{id} resource route).
 */
@ApiTags('Portability')
@ApiBearerAuth()
@Controller('data')
export class PortabilityController {
  constructor(private readonly portability: PortabilityService) {}

  @Post('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'exportData',
    summary: 'Export the caller’s library (streaming download)',
    description:
      'Formats: json (full fidelity — bookmarks, tags, collections, highlights ' +
      'contract section, notes; identities travel as tag names + collection paths), ' +
      'csv (lossy), html (Netscape bookmark file, lossy), txt (one URL per line). ' +
      'The ACTIVE library only — the trash is not exported (plan D17). ' +
      'Optional collectionId scopes the export to that collection’s subtree.',
  })
  @ApiProduces('application/json', 'text/csv', 'text/html', 'text/plain')
  @ApiOkResponse({
    schema: { type: 'string', format: 'binary' },
    description: 'The export document as a file download',
  })
  async exportData(
    @CurrentUser() user: RequestUser,
    @Body() dto: ExportDataDto,
  ): Promise<StreamableFile> {
    // The scope 404s BEFORE the stream starts (a broken download would
    // not be a problem+json response).
    const scope: ExportScope | null = await this.portability.resolveScope(
      user.id,
      dto.collectionId,
    );
    const media = EXPORT_MEDIA[dto.format];

    const stream = Readable.from(this.portability.exportChunks(user, dto.format, scope));
    return new StreamableFile(stream, {
      type: media.contentType,
      disposition: `attachment; filename="arcdrop-export.${media.extension}"`,
    });
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @UserRateLimit('import')
  @UseInterceptors(ImportUploadInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    operationId: 'importData',
    summary: 'Import a bookmark file (multipart) with a URL-keyed upsert summary',
    description:
      'Accepted inputs (detected from the filename): ArcDrop JSON export, ' +
      'Raindrop JSON export, CSV (our export columns), Netscape HTML bookmark ' +
      'file, TXT (one URL per line), ENEX (Evernote — web clips only), ZIP ' +
      '(every supported member). Semantics: upsert on (user, url) match — ' +
      'existing bookmarks are updated (last-write-wins on updatedAt, tags and ' +
      'memberships unioned), new ones created; everything through the normal ' +
      'domain services and change log. One concurrent import per user (409 ' +
      'when busy). Per-user rate limit: 30/min (configurable). Caps: 25 MiB ' +
      'per file, 300 MB for ZIP (configurable).',
  })
  @ApiOkResponse({ type: ImportSummaryDto })
  async importData(
    @CurrentUser() user: RequestUser,
    @ImportFile() upload: ImportFilePayload,
  ): Promise<ImportSummaryDto> {
    return this.portability.importUpload(user, {
      bytes: upload.buffer,
      filename: upload.originalname,
    });
  }
}
