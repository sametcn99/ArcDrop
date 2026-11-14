import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '@api/audit/audit.module';
import { AuthModule } from '@api/auth/auth.module';
import { OneTimeToken } from '@api/database/entities/one-time-token.entity';
import { RefreshToken } from '@api/database/entities/refresh-token.entity';
import { User } from '@api/database/entities/user.entity';
import { MetadataModule } from '@api/metadata/metadata.module';
import { AccountLifecycleService } from './account-lifecycle.service';
import { AdminUsersController } from './admin-users.controller';
import { MeLifecycleController } from './me-lifecycle.controller';
import { UsersService } from './users.service';

/**
 * User & account lifecycle surfaces (plan D3/D15 admin users, M15 self-service
 * reset-data and delete account). Relies on AuthModule's TokenService,
 * PasswordService, and global guards.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, OneTimeToken, RefreshToken]),
    AuthModule,
    AuditModule,
    MetadataModule,
  ],
  controllers: [AdminUsersController, MeLifecycleController],
  providers: [UsersService, AccountLifecycleService],
})
export class UsersModule {}
