import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkCollection } from '@api/database/entities/bookmark-collection.entity';
import { BookmarkTag } from '@api/database/entities/bookmark-tag.entity';
import { BookmarksModule } from '@api/bookmarks/bookmarks.module';
import { ChangeLogModule } from '@api/change-log/change-log.module';
import { MetadataModule } from '@api/metadata/metadata.module';
import { SettingsModule } from '@api/settings/settings.module';
import { BrokenLinksJob } from './broken-links.job';
import { BrokenLinksService } from './broken-links.service';
import { DuplicatesService } from './duplicates.service';
import { LibraryHealthController } from './library-health.controller';

/**
 * Library health (plan M12 / D19, parity G10/G11): normalized-URL duplicates
 * finder + transactional resolver, and the daily SSRF-safe broken-links sweep.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Bookmark, BookmarkTag, BookmarkCollection]),
    BookmarksModule,
    ChangeLogModule,
    MetadataModule,
    SettingsModule,
  ],
  controllers: [LibraryHealthController],
  providers: [DuplicatesService, BrokenLinksService, BrokenLinksJob],
  exports: [DuplicatesService, BrokenLinksService],
})
export class LibraryHealthModule {}
