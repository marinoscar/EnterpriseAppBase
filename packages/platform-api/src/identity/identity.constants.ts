// Internal: the names identity's own code has always used for its role and
// permission ids (`PERMISSIONS.USERS_READ`, `ROLES.ADMIN`), bound to identity's
// declarations. Not exported from the slice: the public names are
// `IDENTITY_PERMISSION_IDS` and `IDENTITY_ROLE_IDS` (./identity.permissions.ts),
// and the app's own `PERMISSIONS` covers every slice.
export {
  DEFAULT_ORG_ROLE,
  IDENTITY_PERMISSION_IDS as PERMISSIONS,
  IDENTITY_ROLE_IDS as ROLES,
  ORG_ADMIN_ROLE,
} from './identity.permissions';
export type { PermissionName, RoleName } from './identity.permissions';
