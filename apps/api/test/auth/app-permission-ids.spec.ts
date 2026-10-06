import { Auth } from '../../src/auth/decorators/auth.decorator';
import { Permissions, PERMISSIONS_KEY } from '../../src/auth/decorators/permissions.decorator';
import { Roles, ROLES_KEY } from '../../src/auth/decorators/roles.decorator';
import type { PermissionName, RoleName } from '../../src/common/constants/roles.constants';

// =============================================================================
// App permission and role ids type-check once augmented (issue #676, PP-1.4)
// =============================================================================
//
// A COMPILE-TIME TEST. Jest only transpiles (isolatedModules), so the
// assertions that matter here are checked by `npm run typecheck`, which covers
// `test/**`: the augmented ids must be accepted by `@Auth()`, `@Permissions()`
// and `@Roles()`, and an id nobody declared must still be rejected (each
// `@ts-expect-error` fails the typecheck if the line stops being an error).
// The runtime half only proves the decorators record what they were given.
//
// This is what a fork writes in `src/app-registrations/permissions.ts`. Because
// a module augmentation is global to the TypeScript program, the ids below are
// valid `PermissionName`/`RoleName` values everywhere `npm run typecheck` looks
// (never in `npm run build`, which compiles `src/` only); they are named
// `compile_check*` so nobody mistakes them for real ones.
// =============================================================================

declare module '../../src/common/permissions/permission.types' {
  interface AppPermissionIds {
    'compile_check:read': true;
  }
  interface AppRoleIds {
    compile_check_role: true;
  }
}

const augmentedPermission: PermissionName = 'compile_check:read';
const platformPermission: PermissionName = 'jobs:read';
const augmentedRole: RoleName = 'compile_check_role';

// @ts-expect-error -- an id nobody declared is still not a PermissionName.
const undeclaredPermission: PermissionName = 'compile_check:write';
// @ts-expect-error -- nor is an undeclared role a RoleName.
const undeclaredRole: RoleName = 'compile_check_other';

class AugmentedController {
  @Auth({ permissions: ['compile_check:read'], roles: ['compile_check_role'] })
  viaAuth(): void {}

  @Permissions('compile_check:read', 'jobs:read')
  @Roles('compile_check_role', 'admin')
  viaPermissionsAndRoles(): void {}

  // @ts-expect-error -- @Auth() rejects an undeclared permission id.
  @Auth({ permissions: ['compile_check:write'] })
  undeclared(): void {}
}

describe('app permission ids (module augmentation)', () => {
  it('lets @Permissions() and @Roles() record augmented ids', () => {
    const handler = AugmentedController.prototype.viaPermissionsAndRoles;

    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['compile_check:read', 'jobs:read']);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['compile_check_role', 'admin']);
  });

  it('lets @Auth() record an augmented permission and role', () => {
    const handler = AugmentedController.prototype.viaAuth;

    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['compile_check:read']);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['compile_check_role']);
  });

  it('keeps the values it was given (the type-level checks run in npm run typecheck)', () => {
    expect([augmentedPermission, platformPermission, augmentedRole]).toEqual([
      'compile_check:read',
      'jobs:read',
      'compile_check_role',
    ]);
    expect([undeclaredPermission, undeclaredRole]).toEqual(['compile_check:write', 'compile_check_other']);
  });
});
