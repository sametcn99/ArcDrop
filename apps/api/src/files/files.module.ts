import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bookmark } from '@api/database/entities/bookmark.entity';
import { UploadUsage } from '@api/database/entities/upload-usage.entity';
import { SettingsModule } from '@api/settings/settings.module';
import { FileEvictionService } from './file-eviction.service';
import { FileStorageService } from './file-storage.service';
import { FileUploadInterceptor } from './file-upload.interceptor';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { UploadQuotaService } from './upload-quota.service';

/**
 * Private user file uploads, quota tracking, serving & eviction (plan M18 / D19).
 *
 * Kept dependency-light (depends only on entities + `SettingsModule`) so
 * `BookmarksModule`, `MetadataModule`, `UsersModule`, `PortabilityModule`, and
 * `McpModule` can import it with zero circular dependencies.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Bookmark, UploadUsage]), SettingsModule],
  controllers: [FilesController],
  providers: [
    FileStorageService,
    FileEvictionService,
    UploadQuotaService,
    FileUploadInterceptor,
    FilesService,
  ],
  exports: [
    FileStorageService,
    FileEvictionService,
    UploadQuotaService,
    FileUploadInterceptor,
    FilesService,
  ],
})
export class FilesModule {}
