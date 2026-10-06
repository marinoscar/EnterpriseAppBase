// =============================================================================
// Declaration map → id map (issue #676, PP-1.4)
// =============================================================================
//
// A pure function in a file that imports nothing, so `roles.constants.ts` can
// derive `ROLES` and `PERMISSIONS` from the declaration files without importing
// the registries (and their manifest) or creating an import cycle.
// `emitDecoratorMetadata` makes cycles painful; see `storage/storage-key-prefixes.ts`
// for the same "no-import leaf" rule.
// =============================================================================

/**
 * Turns a declaration map into a map of its ids, keeping the literal types:
 * `permissionIds({ JOBS_READ: { id: 'jobs:read', ... } })` is
 * `{ readonly JOBS_READ: 'jobs:read' }`.
 *
 * Works for any map of `{ id }` entries (permissions and roles alike). Key
 * order follows the map's own key order.
 *
 * @param map - a declaration map, declared `as const`.
 * @returns a frozen map from each key to its entry's `id`.
 */
export function permissionIds<M extends Readonly<Record<string, { readonly id: string }>>>(
  map: M,
): { readonly [K in keyof M]: M[K]['id'] } {
  const ids: Record<string, string> = {};
  for (const key of Object.keys(map)) ids[key] = map[key].id;
  return Object.freeze(ids) as { readonly [K in keyof M]: M[K]['id'] };
}

/** Alias of {@link permissionIds} for role maps, so call sites read naturally. */
export const roleIds = permissionIds;
