import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { Request } from 'express';
import { User } from '@api/database/entities/user.entity';
import { PersonalAccessToken } from '@api/database/entities/personal-access-token.entity';
import { TokensService } from '@api/tokens/tokens.service';
import { hashPersonalAccessToken, isPersonalAccessToken } from '@api/tokens/pat-token';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestUser } from '../decorators/current-user.decorator';
import { JwtService } from '../crypto/jwt.service';

/**
 * Global bearer-auth guard (plan D2, extended M7). Runs on every route
 * unless the route is `@Public()`. The bearer token is either a 15-minute
 * access JWT (verified, then its user re-loaded from the DB — a disabled
 * user's unexpired tokens die on the next call) or, since M7, a personal
 * access token (`arcdrop_pat_…`, recognized by its prefix): hashed lookup,
 * revoked tokens refused, user re-loaded exactly the same way. PAT
 * principals are tagged (`authKind: 'pat'`, `patId`, `patReadOnly` — the
 * `fam` slot carries the patId); the `PatScopeGuard` builds its surface
 * rules on those tags.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly tokens: TokensService,
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['authorization'];
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = header.slice('Bearer '.length).trim();
    if (token.length === 0) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const principal = isPersonalAccessToken(token)
      ? await this.principalFromPersonalAccessToken(token)
      : await this.principalFromAccessJwt(token);
    request.user = principal;
    return true;
  }

  /** Access JWT path (plan D2): verify, then load the user per request. */
  private async principalFromAccessJwt(token: string): Promise<RequestUser> {
    const claims = this.jwt.verify(token);

    const user = await this.loadActiveUser(claims.sub);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      totpEnabled: user.totpEnabled,
      sub: claims.sub,
      fam: claims.fam,
      createdAt: user.createdAt,
      authKind: 'jwt',
    };
  }

  /** PAT path (M7): sha256 lookup, revocation check, then the same user load. */
  private async principalFromPersonalAccessToken(token: string): Promise<RequestUser> {
    const row = await this.dataSource
      .getRepository(PersonalAccessToken)
      .findOneBy({ tokenHash: hashPersonalAccessToken(token) });
    if (!row || row.revokedAt !== null) {
      throw new UnauthorizedException('Invalid or revoked personal access token');
    }

    // Same rule as JWTs: a disabled user's tokens stop working immediately.
    const user = await this.loadActiveUser(row.userId);

    // Best-effort telemetry — never a reason to fail the request.
    this.tokens.touch(row.id);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      totpEnabled: user.totpEnabled,
      sub: user.id,
      fam: row.id, // no refresh family — the PAT row id occupies the slot
      createdAt: user.createdAt,
      authKind: 'pat',
      patId: row.id,
      patReadOnly: row.readOnly,
    };
  }

  /** Per-request user load — the reason revocation/disabling is immediate. */
  private async loadActiveUser(id: string): Promise<User> {
    const user = await this.dataSource.getRepository(User).findOneBy({ id });
    if (!user || user.status !== 'active') {
      // Unknown user, or disabled — unexpired tokens must not keep working.
      throw new UnauthorizedException('User is not active');
    }
    return user;
  }
}
