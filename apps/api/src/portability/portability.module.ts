import { Module } from '@nestjs/common';
import { PortabilityController } from './portability.controller';
import { HighlightsExportController } from './highlights-export.controller';
import { PortabilityService } from './portability.service';
import { ImportUploadInterceptor } from './import-upload.interceptor';
import { ImportUpsertService } from './import/import-upsert.service';
import { BookmarksModule } from '@api/bookmarks/bookmarks.module';
import { ChangeLogModule } from '@api/change-log/change-log.module';
import { MetadataModule } from '@api/metadata/metadata.module';

/**
 * Portability (plan M8): export/import across the full format set. The
 * upsert engine rides the bookmarks module's shared domain services
 * (`TagsService`, `UrlDecompositionService`), the change log (D4) and the
 * metadata pipeline (post-import fills, bounded) — no new persistence of
 * its own.
 */
@Module({
  imports: [BookmarksModule, ChangeLogModule, MetadataModule],
  controllers: [PortabilityController, HighlightsExportController],
  providers: [PortabilityService, ImportUpsertService, ImportUploadInterceptor],
  exports: [PortabilityService],
})
export class PortabilityModule {}
