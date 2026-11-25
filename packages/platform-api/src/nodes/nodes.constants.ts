// Internal: the names the fleet's own code has always used for its permission
// and role ids (`PERMISSIONS.NODES_READ`, `ROLES.ADMIN`), bound to the slice's
// declarations. Not exported from the slice: the public name is
// `NODES_PERMISSIONS` (./nodes.permissions.ts).

import { IDENTITY_ROLE_IDS } from '../identity/index';
import { NODES_PERMISSIONS } from './nodes.permissions';

export const PERMISSIONS = Object.freeze({
  NODES_READ: NODES_PERMISSIONS.NODES_READ.id,
  NODES_WRITE: NODES_PERMISSIONS.NODES_WRITE.id,
} as const);

export const ROLES = IDENTITY_ROLE_IDS;
