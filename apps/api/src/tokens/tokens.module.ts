import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonalAccessToken } from '@api/database/entities/personal-access-token.entity';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';

/**
 * Personal access tokens (plan M7/D23) — agent auth. The service is
 * exported because the global `JwtAuthGuard` (AuthModule) accepts PATs and
 * bumps `lastUsedAt` through it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PersonalAccessToken])],
  controllers: [TokensController],
  providers: [TokensService],
  exports: [TokensService],
})
export class TokensModule {}
