import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { Principal } from '../../../core/index';
import { toRequestUser, AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permissions required - allow access
    if (!requiredPermissions || requiredPermissions.length === 0) {
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
    const hasAllPermissions = requiredPermissions.every((permission) =>
      granted.includes(permission),
    );

    if (!hasAllPermissions) {
      const missing = requiredPermissions.filter(
        (p) => !granted.includes(p),
      );
      throw new ForbiddenException(
        `Missing permissions: ${missing.join(', ')}`,
      );
    }

    // Attach simplified user to request for convenience
    request.requestUser = requestUser;

    return true;
  }
}
