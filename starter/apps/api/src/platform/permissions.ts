// The roles and permissions this app seeds: the identity slice's roles, the
// permission declarations of every platform slice the app mounts, then the
// app's own. Pure data, no Nest: `prisma/seed.ts` reads it.
//
// ENABLING ANOTHER SLICE adds its declarations here too (for example
// `STORAGE_PERMISSIONS` from `@marinoscar/platform-api/storage`), so the
// seed writes the rows its routes check.
import { IDENTITY_ROLES, ALLOWLIST_PERMISSIONS, ORGANIZATIONS_PERMISSIONS, USERS_PERMISSIONS } from '@marinoscar/platform-api/identity';
import { JOBS_PERMISSIONS } from '@marinoscar/platform-api/jobs';
import { NODES_PERMISSIONS } from '@marinoscar/platform-api/nodes';
import { ORG_SETTINGS_PERMISSIONS, SETTINGS_PERMISSIONS } from '@marinoscar/platform-api/settings';

import { NOTES_PERMISSIONS } from '../notes/notes.permissions';

/** One role, as the seed and the conformance suite see it. */
export interface RoleEntry {
  readonly id: string;
  readonly description: string;
  readonly scope: 'system' | 'org';
}

/** One permission and the roles granted it by default. */
export interface PermissionEntry extends RoleEntry {
  readonly defaultGrants: readonly string[];
}

export const ROLES: readonly RoleEntry[] = Object.values(IDENTITY_ROLES);

export const PERMISSIONS: readonly PermissionEntry[] = [
  SETTINGS_PERMISSIONS,
  USERS_PERMISSIONS,
  ALLOWLIST_PERMISSIONS,
  JOBS_PERMISSIONS,
  NODES_PERMISSIONS,
  ORGANIZATIONS_PERMISSIONS,
  ORG_SETTINGS_PERMISSIONS,
  NOTES_PERMISSIONS,
].flatMap((declarations) => Object.values(declarations as Record<string, PermissionEntry>));

/** Role to permissions: the default grants the seed writes. */
export function defaultGrants(): Record<string, string[]> {
  const grants: Record<string, string[]> = Object.fromEntries(ROLES.map((role) => [role.id, []]));
  for (const permission of PERMISSIONS) {
    for (const role of permission.defaultGrants) (grants[role] ??= []).push(permission.id);
  }
  return grants;
}
