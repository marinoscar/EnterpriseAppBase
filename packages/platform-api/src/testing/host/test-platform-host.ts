// =============================================================================
// A platform host for PACKAGE tests (issue #696, PP-2.7)
// =============================================================================
//
// ⚠ NEVER FOR AN APP. The access decorators below trust a request header: the
// caller names its own permissions in `x-test-permissions`. That is exactly
// what a package test needs (drive 401/403/200 through a real Nest app without
// the app's JWT stack) and exactly what production must never do. An app
// builds its host from its own auth decorators (`definePlatformHost`).
// =============================================================================

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';

import { definePlatformHost } from '../../core/index';
import type { PlatformHost } from '../../core/index';

/**
 * The request header the test host reads: a comma-separated permission list.
 * Absent means "not signed in" (401); present means signed in with exactly
 * those permissions.
 *
 * @stability experimental
 */
export const TEST_PERMISSIONS_HEADER = 'x-test-permissions';

/**
 * Metadata key under which the test host records the permissions a handler
 * requires, so a package test can assert what a controller declares.
 *
 * @stability experimental
 */
export const TEST_REQUIRED_PERMISSIONS_KEY = 'platform:test-required-permissions';

function headerOf(context: ExecutionContext): string | undefined {
  const request = context.switchToHttp().getRequest<{ headers?: Record<string, string | string[] | undefined> }>();
  const raw = request?.headers?.[TEST_PERMISSIONS_HEADER];
  return Array.isArray(raw) ? raw.join(',') : raw;
}

class TestAccessGuard implements CanActivate {
  constructor(private readonly required: readonly string[]) {}

  canActivate(context: ExecutionContext): boolean {
    const header = headerOf(context);
    if (header === undefined) throw new UnauthorizedException('No x-test-permissions header');
    const held = new Set(
      header
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    );
    const missing = this.required.filter((p) => !held.has(p));
    if (missing.length > 0) throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    return true;
  }
}

/**
 * A {@link PlatformHost} whose access decorators read the
 * `x-test-permissions` request header: no header is 401, a missing permission
 * is 403. For package tests only, never for apps.
 *
 * @returns a validated host (built with `definePlatformHost`).
 *
 * @example
 * ```ts
 * const module = await Test.createTestingModule({
 *   imports: [DoctorModule.forRoot({ host: createTestPlatformHost() })],
 * }).compile();
 * // GET /admin/doctor with `x-test-permissions: system_settings:read` -> 200
 * ```
 *
 * @stability experimental
 */
export function createTestPlatformHost(): PlatformHost {
  return definePlatformHost({
    access: {
      requirePermissions: (permissions) =>
        applyDecorators(
          SetMetadata(TEST_REQUIRED_PERMISSIONS_KEY, [...permissions]),
          UseGuards(new TestAccessGuard([...permissions])),
        ),
      requireAuthenticated: () =>
        applyDecorators(SetMetadata(TEST_REQUIRED_PERMISSIONS_KEY, []), UseGuards(new TestAccessGuard([]))),
    },
  });
}
