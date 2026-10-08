import { SetMetadata } from '@nestjs/common';
import { PermissionName } from '../../identity.constants';

/**
 * The metadata key `@Permissions(...)` writes and `PermissionsGuard` reads.
 *
 * @stability stable
 */
export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator to specify required permissions for an endpoint
 * User must have ALL of the specified permissions
 *
 * @example
 * ```ts
 * class ExampleController {
 *   @Permissions('users:read', 'users:write')
 *   update() {}
 * }
 * ```
 *
 * @param permissions - every permission the caller must hold.
 * @returns the metadata decorator `PermissionsGuard` reads.
 *
 * @stability stable
 */
export const Permissions = (...permissions: PermissionName[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
