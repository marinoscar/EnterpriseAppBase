// The viewer's permissions and roles (issue #727, PP-6.6), moved from the
// reference app's `hooks/usePermissions.ts`. These only decide what the UI
// shows; the API enforces every permission.

import { useCallback, useMemo } from 'react';

import { useAuth } from './auth-context.js';

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
 * @returns see {@link UsePermissionsReturn}.
 * @throws Error outside an `AuthProvider`.
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
  const { user } = useAuth();

  const permissions = useMemo(() => {
    return new Set(user?.permissions || []);
  }, [user?.permissions]);

  const roles = useMemo(() => {
    return new Set(user?.roles?.map((r) => r.name) || []);
  }, [user?.roles]);

  const hasPermission = useCallback(
    (permission: string): boolean => {
      return permissions.has(permission);
    },
    [permissions],
  );

  const hasAnyPermission = useCallback(
    (...perms: string[]): boolean => {
      return perms.some((p) => permissions.has(p));
    },
    [permissions],
  );

  const hasAllPermissions = useCallback(
    (...perms: string[]): boolean => {
      return perms.every((p) => permissions.has(p));
    },
    [permissions],
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
