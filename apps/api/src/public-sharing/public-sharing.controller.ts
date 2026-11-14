import { Controller, Get, Header, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '@api/auth/decorators/public.decorator';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import {
  PublicCollectionPageDto,
  PublicCollectionQueryDto,
  PublicShareTokenParamDto,
} from './public-sharing.dto';
import { PublicSharingService } from './public-sharing.service';

/**
 * Unauthenticated read-only surface for publicly shared collections and
 * their RSS 2.0 feeds (plan M19 / D19).
 *
 * Security & privacy invariants:
 * - Annotated `@Public()` (no bearer auth), `@SkipThrottle()` + dedicated
 *   `PublicRateLimitGuard` enforcing a shared per-IP `/public/*` bucket
 *   (`ARCDROP__RATE_LIMIT__PUBLIC_PER_MINUTE`, default 60/min).
 * - Unknown, malformed, disabled, or trashed share tokens return identical 404s.
 * - Exposes ONLY allowlisted bookmark fields (`title`, `url`, `excerpt`,
 *   `coverRef`, `iconRef`, `tags`, `contentType`, `createdAt`) — notes,
 *   highlights, and uploaded file bytes are NEVER exposed.
 */
@ApiTags('Public')
@Public()
@SkipThrottle()
@UseGuards(PublicRateLimitGuard)
@Controller('public/collections')
export class PublicCollectionsController {
  constructor(private readonly publicSharing: PublicSharingService) {}

  @Get(':shareToken')
  @Header('Cache-Control', 'public, max-age=60')
  @ApiOperation({
    operationId: 'getPublicCollection',
    summary: 'Fetch a publicly shared collection tree and paged bookmarks (no auth — M19)',
    description:
      'Returns the shared collection with active nested children and paged active ' +
      'bookmarks restricted to allowlisted public fields (`title`, `url`, `excerpt`, ' +
      '`coverRef`, `iconRef`, `tags`, `contentType`, `createdAt`). Notes, highlights, ' +
      'and uploaded file bytes are never exposed. File-backed items include metadata ' +
      'only (`url: null`). Unknown, disabled, or trashed tokens return 404.',
  })
  @ApiOkResponse({ type: PublicCollectionPageDto })
  getCollection(
    @Param() params: PublicShareTokenParamDto,
    @Query() query: PublicCollectionQueryDto,
  ): Promise<PublicCollectionPageDto> {
    return this.publicSharing.getCollection(params.shareToken, query);
  }

  @Get(':shareToken/rss')
  @ApiOperation({
    operationId: 'getPublicCollectionRss',
    summary:
      'Fetch the RSS 2.0 feed (newest 50 items) for a publicly shared collection (no auth — M19)',
    description:
      'Returns valid RSS 2.0 XML (`application/rss+xml; charset=utf-8`) with channel ' +
      'title set to the collection path and up to the newest 50 active bookmarks ' +
      'across the shared subtree. Unknown, disabled, or trashed tokens return 404.',
  })
  @ApiProduces('application/rss+xml')
  @ApiOkResponse({
    schema: { type: 'string' },
    description: 'Valid RSS 2.0 XML feed for the shared collection',
  })
  async getRss(
    @Param() params: PublicShareTokenParamDto,
    @Req() request: Request,
    @Res() res: Response,
  ): Promise<void> {
    const xml = await this.publicSharing.getRss(params.shareToken, resolveRequestOrigin(request));
    res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(xml);
  }
}

function resolveRequestOrigin(request: Request): string {
  const protocol = request.protocol === 'https' ? 'https' : 'http';
  const host = request.get('host')?.trim();
  if (!host) return `${protocol}://localhost`;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return `${protocol}://localhost`;
  }
}
