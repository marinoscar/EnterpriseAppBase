// The roles the caller may read (PP-14.15): the vocabulary the invite, member
// and user-role dialogs offer. The API decides which roles exist and which may
// be assigned; this hook only reads `GET /api/roles`.

import { useEffect, useMemo, useState } from 'react';

import { useIsMounted } from '../../internal/use-is-mounted.js';
import { useIdentityApi } from '../adapters.js';
import type { IdentityApi, RoleDescriptor, RoleScope } from '../api.js';

/**
 * What {@link useRoles} returns.
 *
 * @stability experimental
 */
export interface UseRolesReturn {
  /** Every role the API listed for the scope, in its order (assignable or not). */
  roles: RoleDescriptor[];
  /** The roles a caller may assign (`assignable`): what a dialog offers. */
  assignable: RoleDescriptor[];
  /** The display name of a role id: its label, or the id itself for a role the list does not hold. */
  labelOf: (roleId: string) => string;
  /** The request is in flight. */
  isLoading: boolean;
  /** The failure's message, or `null`. A failed read leaves the lists empty: the dialogs then offer nothing the API has not vouched for. */
  error: string | null;
}

/**
 * Options of {@link useRoles}.
 *
 * @stability experimental
 */
export interface UseRolesOptions {
  /** Read nothing while `false` (a dialog that is closed, a page the caller may not read). Default `true`. */
  enabled?: boolean;
  /** The identity client; default {@link useIdentityApi}'s. */
  api?: IdentityApi;
}

/**
 * The roles of one scope, over `GET /api/roles` (`users:read` for `system`,
 * `org_members:read` for `org`). Read once per scope while `enabled`.
 *
 * @param scope - `system`, `org`, or omitted for every scope the caller may read.
 * @param options - see {@link UseRolesOptions}.
 * @returns see {@link UseRolesReturn}.
 *
 * @example
 * ```tsx
 * const { assignable, labelOf } = useRoles('org');
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useRoles(scope?: RoleScope, options: UseRolesOptions = {}): UseRolesReturn {
  const { enabled = true, api } = options;
  const identity = useIdentityApi(api);
  const isMounted = useIsMounted();
  const [roles, setRoles] = useState<RoleDescriptor[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    identity
      .getRoles(scope)
      .then((list) => {
        if (!cancelled && isMounted()) setRoles(Array.isArray(list) ? list : []);
      })
      .catch((err: unknown) => {
        if (cancelled || !isMounted()) return;
        setRoles([]);
        setError(err instanceof Error && err.message ? err.message : 'Failed to load roles');
      })
      .finally(() => {
        if (!cancelled && isMounted()) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identity, scope, enabled, isMounted]);

  return useMemo(
    () => ({
      roles,
      assignable: roles.filter((role) => role.assignable),
      labelOf: (roleId: string) => roles.find((role) => role.id === roleId)?.label ?? roleId,
      isLoading,
      error,
    }),
    [roles, isLoading, error],
  );
}
