// =============================================================================
// Telemetry permissions (issue #676, PP-1.4)
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

// Epic #528, story #533 — ADMIN ONLY, same reasoning as the operational
// surfaces above: telemetry settings and ad-hoc queries against
// observability data start as narrow as `db_backup:*`/`ai_config:*` and
// can be widened later without a migration, since these are rows.
export const TELEMETRY_PERMISSIONS = {
  // Telemetry (epic #528, story #533). THREE permissions, mirroring the
  // `ai_config:*`/`ai:use` split above and the `db_backup:*` trio: `READ` and
  // `WRITE` gate the DEPLOYMENT-WIDE policy (whether telemetry is collected,
  // its retention, and the query/assistant bounds) and are Admin-only, same
  // "narrow, operational surface" posture as `storage_config:*`/`push:*`/
  // `broadcasts:*`/`nodes:*`/`ai_config:*` above. `QUERY` is the separate act
  // of actually running SQL, exporting results, or invoking the AI assistant
  // against telemetry data — comparable in kind to `db_backup:restore`, an
  // act materially different from reading or changing the policy that governs
  // it — and is seeded Admin-only as well.
  TELEMETRY_READ: {
    id: 'telemetry:read',
    description: 'View telemetry settings and status',
    defaultGrants: ['admin'],
  },
  TELEMETRY_WRITE: {
    id: 'telemetry:write',
    description: 'Change telemetry settings',
    defaultGrants: ['admin'],
  },
  TELEMETRY_QUERY: {
    id: 'telemetry:query',
    description: 'Run SQL, export and use the AI assistant against telemetry',
    defaultGrants: ['admin'],
  },
} as const satisfies PermissionDeclarationMap;
