// The role and permission registries (issue #676, PP-1.4). Recipe: ./README.md.
//
// Importing this folder fills both registries (the manifest runs first). The
// declaration types live in ./permission.types; `roles.constants.ts` derives
// `ROLES` and `PERMISSIONS` from the declaration files without importing this.

import './permission.manifest';

export {
  permissionIds,
  permissionRegistry,
  registerPermissions,
  registerRoles,
  roleIds,
  roleRegistry,
} from './permission.registry';
export {
  PERMISSION_CATALOG_COMMAND,
  PERMISSION_CATALOG_PATH,
  buildPermissionCatalog,
  renderPermissionCatalog,
} from './permission-catalog';
export type { PermissionCatalog } from './permission-catalog';
export { PLATFORM_ROLES } from './platform-roles';
export type {
  AppPermissionIds,
  AppRoleIds,
  PermissionDeclaration,
  PermissionDeclarationMap,
  RoleDeclaration,
  RoleDeclarationMap,
} from './permission.types';
