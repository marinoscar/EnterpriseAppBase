// The permission and role strings the notifications slice's routes and
// listeners name, derived from the declarations (never retyped), as the jobs
// slice's `jobs.constants.ts` does. Internal: not exported by the barrel.

import { IDENTITY_ROLE_IDS } from '../identity/index';
import { JOBS_PERMISSIONS } from '../jobs/index';
import { NODES_PERMISSIONS } from '../nodes/index';
import { BROADCASTS_PERMISSIONS, ORG_BROADCASTS_PERMISSIONS, PUSH_PERMISSIONS } from './notifications.permissions';

export const PERMISSIONS = Object.freeze({
  BROADCASTS_READ: BROADCASTS_PERMISSIONS.BROADCASTS_READ.id,
  BROADCASTS_WRITE: BROADCASTS_PERMISSIONS.BROADCASTS_WRITE.id,
  ORG_BROADCASTS_READ: ORG_BROADCASTS_PERMISSIONS.ORG_BROADCASTS_READ.id,
  ORG_BROADCASTS_WRITE: ORG_BROADCASTS_PERMISSIONS.ORG_BROADCASTS_WRITE.id,
  PUSH_READ: PUSH_PERMISSIONS.PUSH_READ.id,
  PUSH_WRITE: PUSH_PERMISSIONS.PUSH_WRITE.id,
  // The audiences of the operational events (`jobs.job_failed`,
  // `nodes.node_offline`): whoever can act on them.
  JOBS_READ: JOBS_PERMISSIONS.JOBS_READ.id,
  NODES_READ: NODES_PERMISSIONS.NODES_READ.id,
} as const);

export const ROLES = IDENTITY_ROLE_IDS;
