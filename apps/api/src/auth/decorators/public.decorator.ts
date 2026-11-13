import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'arcdrop:isPublic';

/**
 * Marks a route as reachable WITHOUT a bearer token. The global
 * `JwtAuthGuard` checks this metadata first — anything not marked public
 * requires a valid access token from an active user.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
