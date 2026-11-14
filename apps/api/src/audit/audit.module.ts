import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLogEntry } from '@api/database/entities/audit-log-entry.entity';
import { AdminAuditController } from './admin-audit.controller';
import { AuditService } from './audit.service';

/**
 * Audit logging (plan M7 write side, M9 admin actions + read side).
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntry])],
  controllers: [AdminAuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
