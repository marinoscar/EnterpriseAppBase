import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { Principal } from '../../../core/index';
import { toRequestUser, AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/**
 * Admits a caller holding ALL the permissions `@Permissions(...)` names, in
 * their effective set (system grants plus the current organization's).
 * Applied by `@Auth()` after `JwtAuthGuard`.
 *
 * @stability stable
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  /**
   * Whether the request's user holds every required permission.
   *
   * @param context - the execution context.
   * @returns `true` to admit; throws `ForbiddenException` otherwise.
   */
  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    const anyOf = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const required = requiredPermissions ?? [];
    const alternatives = anyOf ?? [];

    // No permissions required - allow access
    if (required.length === 0 && alternatives.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user) {
      throw new ForbiddenException('No user in request');
    }

    const requestUser = toRequestUser(user);

    // The request's principal (#724) is authoritative when `JwtAuthGuard` set
    // it: its permissions are the active org's. Both are derived from the same
    // bound graph, so they agree; the fallback serves a request whose
    // principal was never attached (a unit test's hand-built request).
    const principal = request.principal as Principal | undefined;
    const granted: readonly string[] = principal?.permissions ?? requestUser.permissions;

    // Check if user has ALL required permissions
    const hasAllPermissions = required.every((permission) =>
      granted.includes(permission),
    );

    if (!hasAllPermissions) {
      const missing = required.filter(
        (p) => !granted.includes(p),
      );
      throw new ForbiddenException(
        `Missing permissions: ${missing.join(', ')}`,
      );
    }

    // Attach simplified user to request for convenience
    // `@Auth({ anyPermissions })` (#738): at least one of them.
    if (alternatives.length > 0 && !alternatives.some((permission) => granted.includes(permission))) {
      throw new ForbiddenException(`Missing permissions: one of ${alternatives.join(', ')}`);
    }

    request.requestUser = requestUser;

    return true;
  }
}
