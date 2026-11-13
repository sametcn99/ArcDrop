import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AccessTokenClaims } from '../crypto/jwt.service';

/** The authenticated principal attached to the request by `JwtAuthGuard`. */
export interface RequestUser extends AccessTokenClaims {
  id: string;
  email: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  /** Refresh-token family this access token belongs to (the session). */
  fam: string;
  createdAt: Date;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: RequestUser;
  }
}

type Selector<T> = (user: RequestUser) => T;

export const CurrentUser = createParamDecorator(
  (selector: Selector<unknown> | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user) {
      // Only reachable through a mis-wired route (guard missing/ordered
      // wrong) — fail loudly instead of leaking `undefined` into handlers.
      throw new Error('CurrentUser used on a route without an authenticated user');
    }
    return selector ? selector(user) : user;
  },
);
