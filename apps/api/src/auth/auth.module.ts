import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import { OneTimeToken } from '@api/database/entities/one-time-token.entity';
import { RefreshToken } from '@api/database/entities/refresh-token.entity';
import { TfaRecoveryCode } from '@api/database/entities/tfa-recovery-code.entity';
import { User } from '@api/database/entities/user.entity';
import { SettingsModule } from '@api/settings/settings.module';
import { TokensModule } from '@api/tokens/tokens.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtService } from './crypto/jwt.service';
import { PasswordService } from './crypto/password.service';
import { TokenService } from './crypto/token.service';
import { TotpService } from './crypto/totp.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PatScopeGuard } from './guards/pat-scope.guard';
import { RolesGuard } from './guards/roles.guard';

/**
 * Auth & users infrastructure (plan M2/D2/D3/D15, PATs M7/D23, TOTP 2FA M15).
 *
 * The four global guards are registered here in deliberate order:
 * 1. `ThrottlerGuard` — cheap rate limiting runs before any crypto;
 * 2. `JwtAuthGuard`  — bearer verification (access JWT or personal access
 *    token) + per-request user status check;
 * 3. `PatScopeGuard` — PAT-only surface rules: /auth, /admin, and /me
 *    unreachable, read-only tokens GET-only on REST, per-PAT rate budget;
 * 4. `RolesGuard`    — enforces `@Roles('admin')` on the admin surface.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, OneTimeToken, TfaRecoveryCode]),
    SettingsModule,
    TokensModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtService,
    PasswordService,
    TokenService,
    TotpService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PatScopeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtService, TokenService, PasswordService],
})
export class AuthModule {}
