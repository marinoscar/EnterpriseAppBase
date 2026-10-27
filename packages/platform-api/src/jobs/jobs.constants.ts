// Internal: the names the queue's own code has always used for its permission
// and role ids (`PERMISSIONS.JOBS_READ`, `ROLES.ADMIN`), bound to the slice's
// declarations. Not exported from the slice: the public name is
// `JOBS_PERMISSIONS` (./jobs.permissions.ts), and the app's own `PERMISSIONS`
// covers every slice.

import { IDENTITY_ROLE_IDS } from '../identity/index';
import { JOBS_PERMISSIONS } from './jobs.permissions';

export const PERMISSIONS = Object.freeze({
  JOBS_READ: JOBS_PERMISSIONS.JOBS_READ.id,
  JOBS_WRITE: JOBS_PERMISSIONS.JOBS_WRITE.id,
} as const);

export const ROLES = IDENTITY_ROLE_IDS;
