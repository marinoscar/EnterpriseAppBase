// =============================================================================
// Declaration map -> id map (issue #676; packaged #866)
// =============================================================================
//
// A pure function in a file that imports nothing, so an app's constants file
// (the reference app: `common/constants/roles.constants.ts`) can derive `ROLES`
// and `PERMISSIONS` from the declaration maps without filling any registry.
// =============================================================================

/**
 * Turns a declaration map into a map of its ids, keeping the literal types:
 * `permissionIds({ JOBS_READ: { id: 'jobs:read', ... } })` is
 * `{ readonly JOBS_READ: 'jobs:read' }`.
 *
 * Works for any map of `{ id }` entries (permissions and roles alike). Key
 * order follows the map's own key order.
 *
 * @param map - a declaration map.
 * @returns a frozen map from each key to its entry's `id`.
 *
 * @example
 * ```ts
 * export const PERMISSIONS = permissionIds(PLATFORM_PERMISSIONS); // { JOBS_READ: 'jobs:read', ... }
 * ```
 *
 * @stability stable
 */
export function permissionIds<M extends Readonly<Record<string, { readonly id: string }>>>(
  map: M,
): { readonly [K in keyof M]: M[K]['id'] } {
  const ids: Record<string, string> = {};
  for (const key of Object.keys(map)) ids[key] = map[key]!.id;
  return Object.freeze(ids) as { readonly [K in keyof M]: M[K]['id'] };
}

/**
 * Alias of {@link permissionIds} for role maps, so call sites read naturally.
 *
 * @example
 * ```ts
 * export const ROLES = roleIds(PLATFORM_ROLES); // { ADMIN: 'admin', ... }
 * ```
 *
 * @stability stable
 */
export const roleIds: typeof permissionIds = permissionIds;
