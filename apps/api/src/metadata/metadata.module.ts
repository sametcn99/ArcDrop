import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { ChangeLogModule } from '@api/change-log/change-log.module';
import { IconCacheService } from './icon-cache.service';
import { IconEvictionJob } from './icon-eviction.job';
import { IconEvictionService } from './icon-eviction.service';
import { IconsController } from './icons.controller';
import { MetadataFetchService } from './metadata-fetch.service';
import { SsrfSafeFetchService } from './ssrf-fetch.service';

/**
 * Metadata & icons (plan M6 / D18): the SSRF-hardened fetch pipeline, the
 * icon cache on the data volume, the PUBLIC icon serve route, the daily
 * eviction job and the reindex service. Exported so the bookmarks module
 * can schedule enrichment (create / url update / reindex), fire the eviction
 * ride-along after trash purges, and M12 library-health can reuse the SSRF
 * fetcher directly via `SsrfSafeFetchService.probeUrl`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Bookmark]), ChangeLogModule],
  controllers: [IconsController],
  providers: [
    SsrfSafeFetchService,
    IconCacheService,
    MetadataFetchService,
    IconEvictionService,
    IconEvictionJob,
  ],
  exports: [MetadataFetchService, IconEvictionService, IconCacheService, SsrfSafeFetchService],
})
export class MetadataModule {}
