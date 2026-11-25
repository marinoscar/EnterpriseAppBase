// The consumer's platform host: what an app writes once in its own
// `src/platform/platform-host.ts` (the reference app's is
// apps/api/src/platform/platform-host.ts). Here the "auth system" is a
// test-only guard, so the smoke can prove the fail-closed access contract
// from outside the monorepo:
//
//   no `x-smoke: 1` header                          -> 401
//   header, but the route's permission not granted  -> 403
//   header and `x-smoke-grants: <the permission>`   -> the route runs
//
// Never use a header guard like this in a real app.

import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { definePlatformHost } from '@marinoscar/platform-api/core';

export const SMOKE_PERMISSIONS_KEY = 'smoke:permissions';

type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string {
  const value = headers[name];
  return Array.isArray(value) ? value.join(',') : (value ?? '');
}

@Injectable()
export class SmokeAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { headers } = context.switchToHttp().getRequest<{ headers: HeaderBag }>();
    if (header(headers, 'x-smoke') !== '1') throw new UnauthorizedException('x-smoke: 1 is required');

    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(SMOKE_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const granted = new Set(
      header(headers, 'x-smoke-grants')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    );
    const missing = required.filter((permission) => !granted.has(permission));
    if (missing.length > 0) throw new ForbiddenException(`missing permission: ${missing.join(', ')}`);
    return true;
  }
}

export const platformHost = definePlatformHost({
  access: {
    requirePermissions: (permissions) =>
      applyDecorators(SetMetadata(SMOKE_PERMISSIONS_KEY, [...permissions]), UseGuards(SmokeAccessGuard)),
    requireAuthenticated: () => applyDecorators(UseGuards(SmokeAccessGuard)),
  },
});
