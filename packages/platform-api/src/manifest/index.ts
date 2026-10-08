// `@marinoscar/platform-api/manifest`: what every platform slice registers,
// in registration order (issue #866). The roles and permissions every slice
// declares, in seed order, and the inventory of platform models with a foreign
// key to `User`; the functions that register them, plus an app's own, into
// core's registries. Pure data and plain functions: no Nest module, no
// provider. Documented in ./README.md.

export {
  PLATFORM_PERMISSIONS,
  PLATFORM_PERMISSION_SETS,
  PLATFORM_PERMISSION_SLICES,
  PLATFORM_ROLES,
} from './platform-permissions';
export type { PlatformPermissionSet, PlatformPermissionSlice } from './platform-permissions';
export {
  platformPermissionCatalog,
  platformPermissionDeclarations,
  registerPlatformPermissions,
} from './register-permissions';
export type { PlatformPermissionDeclarations, PlatformPermissionOptions } from './register-permissions';
export { PLATFORM_USER_OWNED_MODELS, registerPlatformUserOwnedModels } from './platform-user-owned-models';
