import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '@api/auth/decorators/public.decorator';
import { IconCacheService } from './icon-cache.service';
import { IconRefParamDto } from './metadata.dto';
/**
 * Public icon serving (plan D18): `GET /api/v1/icons/{id}` requires NO
 * token because web `<img>` tags cannot send Authorization headers — icons
 * are treated as non-sensitive and the id itself is the capability
 * (192-bit random, unguessable). Long-lived immutable cache headers so
 * browsers never refetch, served with the STORED content type (the file
 * extension is the type record). Unknown/malformed refs are 404s — they
 * never confirm which part was wrong.
 */
@ApiTags('Icons')
@Controller('icons')
export class IconsController {
  constructor(private readonly icons: IconCacheService) {}

  @Public()
  @Get(':id')
  // Icons are hot bytes on every client render (a page of bookmarks can
  // embed dozens of covers); the global 100/min default would bite real
  // UIs, so this surface gets its own generous budget.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'getIcon',
    summary: 'Serve a cached icon by its unguessable ref (public — plan D18)',
    description:
      'No authentication: plain <img> tags must work (plan D18). Responds with the ' +
      'stored content type and immutable long-lived cache headers. Unknown or ' +
      'malformed refs are 404s.',
  })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' }, description: 'The icon bytes' })
  async get(@Param() params: IconRefParamDto, @Res() res: Response): Promise<void> {
    const icon = await this.icons.read(params.id);
    if (!icon) throw new NotFoundException('Icon not found');
    res.setHeader('Content-Type', icon.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(Buffer.from(icon.bytes));
  }
}
