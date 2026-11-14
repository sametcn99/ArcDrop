import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '@api/auth/auth.module';
import { ChangeLogModule } from '@api/change-log/change-log.module';
import { ChangeEvent } from '@api/database/entities/change-event.entity';
import { BookmarksModule } from '@api/bookmarks/bookmarks.module';
import { SettingsModule } from '@api/settings/settings.module';
import { ChangeLogRetentionJob } from './change-log-retention.job';
import { ChangeLogRetentionService } from './change-log-retention.service';
import { SyncController } from './sync.controller';
import { SyncGateway } from './sync.gateway';
import { SyncService } from './sync.service';
import { SyncTicketService } from './sync-ticket.service';

/**
 * Sync integration (plan M5, D4; extended M14): the change log as the
 * multi-device backbone.
 *
 * - `ChangeLogModule` supplies the committed-event bus the gateway
 *   subscribes to (single instance, in-process fan-out — Redis scale-out
 *   is explicitly out of scope);
 * - `AuthModule` provides `TokenService` (256-bit tickets, sha256-at-rest);
 * - `SettingsModule` provides the `changeLogRetentionDays` knob;
 * - `BookmarksModule` provides the tag-view helper bookmark snapshots reuse
 *   (the `BookmarkDto` shape stays frozen and byte-identical everywhere).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ChangeEvent]),
    AuthModule,
    ChangeLogModule,
    SettingsModule,
    BookmarksModule,
  ],
  controllers: [SyncController],
  providers: [
    SyncService,
    SyncTicketService,
    SyncGateway,
    ChangeLogRetentionService,
    ChangeLogRetentionJob,
  ],
  exports: [SyncService, SyncTicketService, SyncGateway],
})
export class SyncModule {}
