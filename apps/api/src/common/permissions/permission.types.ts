// =============================================================================
// This app's typed role and permission ids (issue #676; registry packaged #866)
// =============================================================================
//
// The declaration types (`PermissionDeclaration`, `RoleDeclaration`,
// `PermissionScope`, the map types) and the registries are
// `@marinoscar/platform-api/core`'s. What stays here is the app's half: two
// empty interfaces an app widens by module augmentation, so its own ids
// type-check in `@Auth({ permissions })`, `@Permissions(...)` and `@Roles(...)`
// (`common/constants/roles.constants.ts` folds them into `PermissionName` and
// `RoleName`). Recipe: ./README.md.
// =============================================================================

/**
 * The app's own permission ids, added by module augmentation so they type-check
 * in `@Auth({ permissions })` and `@Permissions(...)`:
 *
 * ```ts
 * declare module '../common/permissions/permission.types' {
 *   interface AppPermissionIds {
 *     'workouts:read': true;
 *   }
 * }
 * ```
 *
 * Empty upstream, forever.
 */
export interface AppPermissionIds {}

/** The app's own role ids, added by module augmentation like {@link AppPermissionIds}. Empty upstream. */
export interface AppRoleIds {}
