import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { BookmarkCollection } from '@api/database/entities/bookmark-collection.entity';
import { Collection } from '@api/database/entities/collection.entity';
import { ChangeLogModule } from '@api/change-log/change-log.module';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';

/**
 * Collections (plan M4): hierarchy + tree, membership sync, cycle
 * protection, ordering — change-logged through `ChangeLogModule`. Also
 * registered for the `Bookmark`/`BookmarkCollection` entities because the
 * membership sync and the cascade trash read/write them directly.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Collection, Bookmark, BookmarkCollection]), ChangeLogModule],
  controllers: [CollectionsController],
  providers: [CollectionsService],
  exports: [CollectionsService],
})
export class CollectionsModule {}
