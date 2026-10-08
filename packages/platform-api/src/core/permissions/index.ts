// The role and permission registries (issue #676, packaged by #866).
// Documented in ../README.md ("Roles and permissions"). Framework-free: seeds
// and generators import it with no Nest container. Importing it registers nothing; an app's manifest fills the
// registries (the platform's part: `registerPlatformPermissions()` of
// `@marinoscar/platform-api/manifest`).

export { permissionIds, roleIds } from './permission-ids';
export type { IdentifiedDeclaration } from './permission-ids';
export { permissionRegistry, registerPermissions, registerRoles, roleRegistry } from './permission.registry';
export { buildPermissionCatalog, catalogGrants, composePermissionCatalog } from './permission-catalog';
export type {
  CatalogGrant,
  DeclarationList,
  PermissionCatalog,
  PermissionCatalogDeclarations,
  PermissionCatalogEntry,
  PermissionCatalogSource,
} from './permission-catalog';
export type {
  Declarations,
  PermissionDeclaration,
  PermissionDeclarationMap,
  PermissionScope,
  RoleDeclaration,
  RoleDeclarationMap,
} from './permission.types';
