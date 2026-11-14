import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntry } from '@api/database/entities/audit-log-entry.entity';
import { AuditService } from './audit.service';

/**
 * Audit logging (plan M7) — write side only in v1 (one row per MCP tool
 * call); the M9 admin surface builds the read side on these rows.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntry])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
