import { SetMetadata } from '@nestjs/common';
import { RoleName } from '../../identity.constants';

/**
 * The metadata key `@Roles(...)` writes and `RolesGuard` reads.
 *
 * @stability stable
 */
export const ROLES_KEY = 'roles';

/**
 * Decorator to specify required roles for an endpoint
 * User must have AT LEAST ONE of the specified roles
 *
 * @example
 * ```ts
 * class ExampleController {
 *   @Roles('admin')
 *   operate() {}
 * }
 * ```
 *
 * @param roles - the system roles, any of which admits the caller.
 * @returns the metadata decorator `RolesGuard` reads.
 *
 * @stability stable
 */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
