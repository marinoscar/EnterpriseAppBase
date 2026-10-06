// =============================================================================
// Notification broadcast permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; `common/permissions/permission.manifest.ts`
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

import type { PermissionDeclarationMap } from '../../common/permissions/permission.types';

// #320, epic #319 — ADMIN ONLY, same reasoning as the jobs/nodes/backup
// trio just above: broadcasting reaches every user in the deployment, so
// it starts as narrow as the other operational surfaces here and can be
// widened later without a migration, since these are rows.
export const BROADCASTS_PERMISSIONS = {
  // Notification broadcasts — admin messages fanned out to every user
  // (#320, epic #319).
  //
  // DELIBERATELY SPLIT FROM `system_settings:*`, not folded into it, for the
  // same reason `nodes:*` is split from `jobs:*` above. Sending a message to
  // every user in the deployment is not editing the settings document — it
  // is a one-way broadcast with its own audience, its own history, and no
  // "current value" to read back the way a settings blob has. The Settings
  // UI Pattern (CLAUDE.md rule 3) requires a hub card's `permission` to be
  // the exact string its controller enforces, so a Broadcasts card gated on
  // `system_settings:read` would mirror a permission its controller never
  // checks — the hub would decide reachability on evidence unrelated to
  // whether the request behind it will actually be authorized.
  //
  // Plural, matching this file's own convention for collection resources
  // (`jobs:*`, `nodes:*`, `users:*`) rather than the singular `broadcast:*`.
  BROADCASTS_READ: {
    id: 'broadcasts:read',
    description: 'View notification broadcasts and their delivery history',
    defaultGrants: ['admin'],
  },
  BROADCASTS_WRITE: {
    id: 'broadcasts:write',
    description: 'Compose, schedule, cancel and send notification broadcasts',
    defaultGrants: ['admin'],
  },
} as const satisfies PermissionDeclarationMap;
