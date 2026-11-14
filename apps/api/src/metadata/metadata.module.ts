import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { ChangeLogModule } from '@api/change-log/change-log.module';
import { SettingsModule } from '@api/settings/settings.module';
import { ArchiveRetryJob } from './archive-retry.job';
import { ArchiveStorageService } from './archive-storage.service';
import { IconCacheService } from './icon-cache.service';
import { IconEvictionJob } from './icon-eviction.job';
import { IconEvictionService } from './icon-eviction.service';
import { IconsController } from './icons.controller';
import { MetadataFetchService } from './metadata-fetch.service';
import { SsrfSafeFetchService } from './ssrf-fetch.service';

/**
 * Metadata, icons & permanent archiving (plan M6 / D18; extended M17 / D19):
 * the SSRF-hardened fetch pipeline, readability/PDF content extractor, on-disk
 * icon cache and per-bookmark archive storage, the PUBLIC icon serve route,
 * daily icon eviction, periodic archive retry job, and the reindex service.
 * Exported so BookmarksModule, UsersModule, and LibraryHealthModule can reuse
 * enrichment, archive storage, eviction, and `SsrfSafeFetchService.probeUrl`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Bookmark]), ChangeLogModule, SettingsModule],
  controllers: [IconsController],
  providers: [
    SsrfSafeFetchService,
    IconCacheService,
    ArchiveStorageService,
    MetadataFetchService,
    IconEvictionService,
    IconEvictionJob,
    ArchiveRetryJob,
  ],
  exports: [
    MetadataFetchService,
    ArchiveStorageService,
    IconEvictionService,
    IconCacheService,
    SsrfSafeFetchService,
  ],
})
export class MetadataModule {}
