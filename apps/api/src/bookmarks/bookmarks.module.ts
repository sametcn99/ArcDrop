import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkCollection } from '@api/database/entities/bookmark-collection.entity';
import { BookmarkTag } from '@api/database/entities/bookmark-tag.entity';
import { Highlight } from '@api/database/entities/highlight.entity';
import { Tag } from '@api/database/entities/tag.entity';
import { ChangeLogModule } from '@api/change-log/change-log.module';
import { CollectionsModule } from '@api/collections/collections.module';
import { MetadataModule } from '@api/metadata/metadata.module';
import { SettingsModule } from '@api/settings/settings.module';
import { BookmarksController } from './bookmarks.controller';
import { BookmarksService } from './bookmarks.service';
import { HighlightsController } from './highlights.controller';
import { HighlightsService } from './highlights.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { TrashPurgeJob } from './trash-purge.job';
import { TrashPurgeService } from './trash-purge.service';
import { UrlDecompositionService } from './url-decomposition.service';

/**
 * Bookmarks core (plan M3, enriched M10): CRUD + trash/restore, highlights,
 * tags, search/paging/stats, the trash-purge job and URL decomposition.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Bookmark, BookmarkTag, BookmarkCollection, Highlight, Tag]),
    ChangeLogModule,
    CollectionsModule,
    MetadataModule,
    SettingsModule,
  ],
  controllers: [BookmarksController, HighlightsController, TagsController],
  providers: [
    BookmarksService,
    HighlightsService,
    TagsService,
    UrlDecompositionService,
    TrashPurgeService,
    TrashPurgeJob,
  ],
  exports: [BookmarksService, HighlightsService, TagsService, UrlDecompositionService],
})
export class BookmarksModule {}
