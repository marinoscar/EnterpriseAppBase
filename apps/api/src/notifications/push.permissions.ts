// =============================================================================
// Web Push (VAPID) configuration permissions (issue #676, PP-1.4)
// =============================================================================
//
// Pure data: this module's permissions and their default role grants. Imports
// only types and has no side effect; `common/permissions/permission.manifest.ts`
// registers it, and `common/constants/roles.constants.ts` derives `PERMISSIONS`
// from it. After a change, run `npm run catalog:permissions --workspace=api` and
// commit the regenerated `prisma/catalog/permissions.json`.
// Recipe: common/permissions/README.md.
// =============================================================================

import type { PermissionDeclarationMap } from '../common/permissions/permission.types';

// #355 — ADMIN ONLY, same reasoning: rotating VAPID keys knocks every
// push subscriber offline, so it starts as narrow as the surfaces above
// and can be widened later without a migration, since these are rows.
export const PUSH_PERMISSIONS = {
  // Web Push (VAPID) configuration — runtime key generation/rotation
  // (#355).
  //
  // DELIBERATELY SPLIT FROM `system_settings:*`, not folded into it, for the
  // same reason `nodes:*` is split from `jobs:*` and `broadcasts:*` from
  // `system_settings:*` above. Generating or rotating VAPID key material has
  // a real, described blast radius that a routine settings edit does not:
  // every existing push subscriber goes dark until their browser next
  // resubscribes against the new public key. Folding this into
  // `system_settings:write` would mean anyone trusted to edit a system setting
  // is also trusted to knock out push delivery for the entire user base. The
  // Settings UI Pattern (CLAUDE.md rule 3) requires a hub card's
  // `permission` to be the exact string its controller enforces, so a Push
  // Configuration card gated on `system_settings:*` would mirror a
  // permission `PushConfigController` never checks.
  PUSH_READ: {
    id: 'push:read',
    description: 'View Web Push (VAPID) configuration',
    defaultGrants: ['admin'],
  },
  PUSH_WRITE: {
    id: 'push:write',
    description: 'Generate, rotate, enable/disable and remove Web Push VAPID keys',
    defaultGrants: ['admin'],
  },
} as const satisfies PermissionDeclarationMap;
