// =============================================================================
// Shared PATCH-merge helpers for settings namespace declarations (issue #677)
// =============================================================================
//
// Framework-free and import-free, so a declaration file can use them without
// pulling a service (or a composed schema) into its import graph.
// =============================================================================

/**
 * PATCH merge for an OPTIONAL stored field: `undefined` (absent from the body)
 * keeps `current`, `null` removes the field, anything else replaces it.
 * Returns `undefined` for "removed", which `systemSettingsSchema.parse` then
 * drops from the stored object.
 *
 * @stability experimental
 */
export function mergeOptional<T>(patch: T | null | undefined, current: T | undefined): T | undefined {
  if (patch === undefined) return current;

  return patch === null ? undefined : patch;
}
