import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkCollection } from '@api/database/entities/bookmark-collection.entity';
import { BookmarkTag } from '@api/database/entities/bookmark-tag.entity';
import { Tag } from '@api/database/entities/tag.entity';
import { ChangeLogModule } from '@api/change-log/change-log.module';
import { CollectionsModule } from '@api/collections/collections.module';
import { SettingsModule } from '@api/settings/settings.module';
import { BookmarksController } from './bookmarks.controller';
import { BookmarksService } from './bookmarks.service';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';
import { TrashPurgeJob } from './trash-purge.job';
import { TrashPurgeService } from './trash-purge.service';
import { UrlDecompositionService } from './url-decomposition.service';

/**
 * Bookmarks core (plan M3): CRUD + trash/restore, tags, search/paging/stats,
 * the trash-purge job and the URL decomposition service. The change-log
 * wiring comes from `ChangeLogModule`; `SettingsModule` supplies the
 * retention knob for the purge; `CollectionsModule` (M4) serves
 * `PUT /bookmarks/{id}/collections`. Auth needs no import — the JWT/roles
 * guards are global (registered in AuthModule) and `@CurrentUser` is a
 * plain param decorator.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Bookmark, BookmarkTag, BookmarkCollection, Tag]),
    ChangeLogModule,
    CollectionsModule,
    SettingsModule,
  ],
  controllers: [BookmarksController, TagsController],
  providers: [
    BookmarksService,
    TagsService,
    UrlDecompositionService,
    TrashPurgeService,
    TrashPurgeJob,
  ],
  exports: [BookmarksService, TagsService],
})
export class BookmarksModule {}
