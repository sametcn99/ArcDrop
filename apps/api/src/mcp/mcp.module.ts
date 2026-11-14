import { Module } from '@nestjs/common';
import { AuditModule } from '@api/audit/audit.module';
import { BookmarksModule } from '@api/bookmarks/bookmarks.module';
import { CollectionsModule } from '@api/collections/collections.module';
import { MetadataModule } from '@api/metadata/metadata.module';
import { SyncModule } from '@api/sync/sync.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

/**
 * MCP server (plan M7/D23) — the app surface as tools for external agents.
 * The tool catalog consumes the SAME services the REST controllers use
 * (bookmarks, tags, collections, metadata/reindex, sync), so agents get
 * identical validation, user scoping and change-log semantics; the audit
 * module records every tool call.
 */
@Module({
  imports: [AuditModule, BookmarksModule, CollectionsModule, MetadataModule, SyncModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
