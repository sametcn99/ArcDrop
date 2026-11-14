import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookmarksModule } from '@api/bookmarks/bookmarks.module';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { Collection } from '@api/database/entities/collection.entity';
import { PublicRateLimitGuard } from './public-rate-limit.guard';
import { PublicCollectionsController } from './public-sharing.controller';
import { PublicSharingService } from './public-sharing.service';

@Module({
  imports: [TypeOrmModule.forFeature([Collection, Bookmark]), BookmarksModule],
  controllers: [PublicCollectionsController],
  providers: [PublicSharingService, PublicRateLimitGuard],
})
export class PublicSharingModule {}
