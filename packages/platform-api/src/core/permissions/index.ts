// The role and permission registries (issue #676, packaged by #866). Recipe:
// ./README.md. Framework-free: seeds and generators import it with no Nest
// container. Importing it registers nothing; an app's manifest fills the
// registries (the platform's part: `registerPlatformPermissions()` of
// `@marinoscar/platform-api/manifest`).

export { permissionIds, roleIds } from './permission-ids';
export { permissionRegistry, registerPermissions, registerRoles, roleRegistry } from './permission.registry';
export { buildPermissionCatalog, catalogGrants, composePermissionCatalog } from './permission-catalog';
export type { PermissionCatalog, PermissionCatalogDeclarations, PermissionCatalogSource } from './permission-catalog';
export type {
  Declarations,
  PermissionDeclaration,
  PermissionDeclarationMap,
  PermissionScope,
  RoleDeclaration,
  RoleDeclarationMap,
} from './permission.types';
