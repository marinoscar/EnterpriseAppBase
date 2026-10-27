// The role and permission registries, filled (issue #676, packaged by #866).
// Recipe: ./README.md.
//
// The registries are `@marinoscar/platform-api/core`'s. Importing this folder
// runs the manifest first, so the registries it re-exports are full: import
// `roleRegistry` and `permissionRegistry` from here, not from core, wherever
// the platform's and the app's entries must be present. `roles.constants.ts`
// derives `ROLES` and `PERMISSIONS` from the declarations without importing
// this.

import './permission.manifest';

export { buildPermissionCatalog, permissionRegistry, roleRegistry } from '@marinoscar/platform-api/core';
export {
  PERMISSION_CATALOG_COMMAND,
  PERMISSION_CATALOG_PATH,
  checkPermissionCatalog,
  renderPermissionCatalog,
} from './permission-catalog';
export type { AppPermissionIds, AppRoleIds } from './permission.types';
