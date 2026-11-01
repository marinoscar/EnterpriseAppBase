// The viewer's permissions and roles (issue #727, PP-6.6), moved from the
// reference app's `hooks/usePermissions.ts`. These only decide what the UI
// shows; the API enforces every permission.

import { useCallback, useMemo } from 'react';

import { useOptionalPlatformHost } from '../../core/index.js';
import { useOptionalAuth } from './auth-context.js';

/**
 * What {@link usePermissions} returns. The predicates keep a stable identity
 * across renders while the user's permissions do not change, so callers may
 * key `useMemo`/`useEffect` on them.
 *
 * @stability stable
 */
export interface UsePermissionsReturn {
  /** The effective permissions of the signed-in user. */
  permissions: Set<string>;
  /** The names of the signed-in user's roles. */
  roles: Set<string>;
  /** Whether the user holds `permission` (the exact string the API enforces). */
  hasPermission: (permission: string) => boolean;
  /** Whether the user holds at least one of `perms`. */
  hasAnyPermission: (...perms: string[]) => boolean;
  /** Whether the user holds every one of `perms`. */
  hasAllPermissions: (...perms: string[]) => boolean;
  /** Whether the user has the role `role`. */
  hasRole: (role: string) => boolean;
  /** Whether the user has at least one of `roleList`. */
  hasAnyRole: (...roleList: string[]) => boolean;
  /** Whether the user has the `admin` role. */
  isAdmin: boolean;
}

/**
 * The signed-in user's permissions and roles, as predicates.
 *
 * The source, in order: the {@link AuthContext} (an `AuthProvider`, or the
 * `LocalIdentityProvider` of a local host); else the `PlatformHostProvider`'s
 * viewer (`hasPermission` only: the viewer port cannot list permissions or
 * roles, so `permissions` and `roles` are empty and `isAdmin` is `false`).
 *
 * @returns see {@link UsePermissionsReturn}.
 * @throws Error when neither an `AuthProvider`/`LocalIdentityProvider` nor a `PlatformHostProvider` is mounted.
 *
 * @example
 * ```tsx
 * const { hasPermission } = usePermissions();
 * <Button disabled={!hasPermission('users:write')}>Save</Button>
 * ```
 *
 * @extensionPoint hook
 * @stability stable
 */
export function usePermissions(): UsePermissionsReturn {
  const auth = useOptionalAuth();
  const viewer = useOptionalPlatformHost()?.viewer ?? null;
  const user = auth?.user;

  const permissions = useMemo(() => {
    return new Set(user?.permissions || []);
  }, [user?.permissions]);

  const roles = useMemo(() => {
    return new Set(user?.roles?.map((r) => r.name) || []);
  }, [user?.roles]);

  // The viewer port answers one permission at a time; used only without an AuthContext.
  const viewerCheck = auth === null ? viewer : null;

  const hasPermission = useCallback(
    (permission: string): boolean => {
      return viewerCheck ? viewerCheck.hasPermission(permission) : permissions.has(permission);
    },
    [permissions, viewerCheck],
  );

  const hasAnyPermission = useCallback(
    (...perms: string[]): boolean => {
      return perms.some((p) => hasPermission(p));
    },
    [hasPermission],
  );

  const hasAllPermissions = useCallback(
    (...perms: string[]): boolean => {
      return perms.every((p) => hasPermission(p));
    },
    [hasPermission],
  );

  const hasRole = useCallback(
    (role: string): boolean => {
      return roles.has(role);
    },
    [roles],
  );

  const hasAnyRole = useCallback(
    (...roleList: string[]): boolean => {
      return roleList.some((r) => roles.has(r));
    },
    [roles],
  );

  const isAdmin = useMemo(() => {
    return roles.has('admin');
  }, [roles]);

  if (auth === null && viewer === null) {
    throw new Error(
      'usePermissions: no permission source. Mount an AuthProvider (or a LocalIdentityProvider for a local host) ' +
        "from '@marinoscar/platform-web/identity/headless', or a PlatformHostProvider from '@marinoscar/platform-web/core' " +
        '(its viewer answers hasPermission).',
    );
  }

  return {
    permissions,
    roles,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole,
    hasAnyRole,
    isAdmin,
  };
}
