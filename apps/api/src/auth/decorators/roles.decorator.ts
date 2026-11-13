import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@api/database/entities/user.entity';

export const ROLES_KEY = 'arcdrop:roles';

/**
 * Restricts a route to the given roles (checked by the global `RolesGuard`
 * AFTER authentication). Used for the admin API surface.
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
