import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '@api/auth/auth.module';
import { OneTimeToken } from '@api/database/entities/one-time-token.entity';
import { RefreshToken } from '@api/database/entities/refresh-token.entity';
import { User } from '@api/database/entities/user.entity';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';

/** Admin surface for user management (plan D3/D15) — relies on AuthModule's TokenService and global guards. */
@Module({
  imports: [TypeOrmModule.forFeature([User, OneTimeToken, RefreshToken]), AuthModule],
  controllers: [AdminUsersController],
  providers: [UsersService],
})
export class UsersModule {}
