import { Module } from '@nestjs/common';
import { AuditModule } from '@api/audit/audit.module';
import { BookmarksModule } from '@api/bookmarks/bookmarks.module';
import { CollectionsModule } from '@api/collections/collections.module';
import { LibraryHealthModule } from '@api/library-health/library-health.module';
import { MetadataModule } from '@api/metadata/metadata.module';
import { NotificationsModule } from '@api/notifications/notifications.module';
import { PortabilityModule } from '@api/portability/portability.module';
import { SyncModule } from '@api/sync/sync.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

/**
 * MCP server (plan M7/D23; extended M8/M10/M11/M12/M13/M14) — the app surface as tools
 * for external agents. The tool catalog consumes the SAME services the REST
 * controllers use (bookmarks, tags, collections, metadata/reindex, sync,
 * notifications, portability, library health), so agents get identical validation,
 * user scoping and change-log semantics; the audit module records every tool call.
 */
@Module({
  imports: [
    AuditModule,
    BookmarksModule,
    CollectionsModule,
    LibraryHealthModule,
    MetadataModule,
    NotificationsModule,
    PortabilityModule,
    SyncModule,
  ],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
