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
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestUser } from '../decorators/current-user.decorator';
import { JwtService } from '../crypto/jwt.service';

/**
 * Global bearer-auth guard (plan D2). Runs on every route unless the route
 * is `@Public()`. Verifies the HS256 access token, then loads the user from
 * the database — this is what makes a disabled user's tokens stop working
 * immediately, no matter how fresh they are.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
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

    const claims = this.jwt.verify(token);

    const user = await this.dataSource.getRepository(User).findOneBy({ id: claims.sub });
    if (!user || user.status !== 'active') {
      // Unknown user, or disabled — unexpired tokens must not keep working.
      throw new UnauthorizedException('User is not active');
    }

    const principal: RequestUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      sub: claims.sub,
      fam: claims.fam,
      createdAt: user.createdAt,
    };
    request.user = principal;
    return true;
  }
}
