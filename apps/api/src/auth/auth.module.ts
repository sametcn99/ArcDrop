import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { OneTimeToken } from '@api/database/entities/one-time-token.entity';
import { RefreshToken } from '@api/database/entities/refresh-token.entity';
import { User } from '@api/database/entities/user.entity';
import { SettingsModule } from '@api/settings/settings.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtService } from './crypto/jwt.service';
import { PasswordService } from './crypto/password.service';
import { TokenService } from './crypto/token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

/**
 * Auth & users infrastructure (plan M2/D2/D3/D15).
 *
 * The three global guards are registered here in deliberate order:
 * 1. `ThrottlerGuard` — cheap rate limiting runs before any crypto;
 * 2. `JwtAuthGuard`  — bearer verification + per-request user status check;
 * 3. `RolesGuard`    — enforces `@Roles('admin')` on the admin surface.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken, OneTimeToken]), SettingsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtService,
    PasswordService,
    TokenService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtService, TokenService],
})
export class AuthModule {}
