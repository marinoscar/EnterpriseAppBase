// =============================================================================
// Telemetry permissions (issue #676, PP-1.4; exported as data by #703)
// =============================================================================
//
// Pure data: the slice's three permissions and their default role grants. The
// app registers the declarations with its own permission registry (the
// reference app: `common/permissions/permission.manifest.ts`, which also
// derives `PERMISSIONS` from them in `common/constants/roles.constants.ts`).
// The strings never change: they are rows in `permissions` and the exact
// strings the controllers enforce.
//
// ADMIN ONLY, same reasoning as the other operational surfaces: telemetry
// settings and ad-hoc queries against observability data start as narrow as
// `db_backup:*`/`ai_config:*` and can be widened later without a migration,
// since these are rows. THREE permissions, mirroring the `ai_config:*`/`ai:use`
// split and the `db_backup:*` trio: `READ` and `WRITE` gate the
// DEPLOYMENT-WIDE policy (whether telemetry is collected, its retention, and
// the query/assistant bounds). `QUERY` is the separate act of actually running
// SQL, exporting results, or invoking the AI assistant against telemetry data,
// an act materially different from reading or changing the policy that
// governs it.
// =============================================================================

/**
 * One permission the telemetry slice declares, in the shape an app's
 * permission registry takes.
 *
 * @typeParam Id - the permission string.
 *
 * @stability experimental
 */
export interface TelemetryPermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`: the exact string the slice's routes enforce. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /** Role ids the permission is granted to by default (seeded into `role_permissions`). */
  readonly defaultGrants: readonly string[];
}

/**
 * The telemetry permissions with their descriptions and default grants, keyed
 * by the `PERMISSIONS` constant name the reference app derives from them.
 * Register them with the app's permission registry.
 *
 * @example
 * ```ts
 * registerPermissions(TELEMETRY_PERMISSION_DECLARATIONS);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const TELEMETRY_PERMISSION_DECLARATIONS: {
  /** `telemetry:read`: view telemetry settings and status. */
  readonly TELEMETRY_READ: TelemetryPermissionDeclaration<'telemetry:read'>;
  /** `telemetry:write`: change telemetry settings. */
  readonly TELEMETRY_WRITE: TelemetryPermissionDeclaration<'telemetry:write'>;
  /** `telemetry:query`: run SQL, export, the dashboard and the AI assistant. */
  readonly TELEMETRY_QUERY: TelemetryPermissionDeclaration<'telemetry:query'>;
} = {
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
};

/**
 * The permission strings the telemetry routes enforce: `READ` (settings and
 * status), `WRITE` (change them) and `QUERY` (run SQL, export, the dashboard
 * and the assistant).
 *
 * @stability stable
 */
export const TELEMETRY_PERMISSIONS: {
  /** `telemetry:read`. */
  readonly READ: 'telemetry:read';
  /** `telemetry:write`. */
  readonly WRITE: 'telemetry:write';
  /** `telemetry:query`. */
  readonly QUERY: 'telemetry:query';
} = {
  READ: TELEMETRY_PERMISSION_DECLARATIONS.TELEMETRY_READ.id,
  WRITE: TELEMETRY_PERMISSION_DECLARATIONS.TELEMETRY_WRITE.id,
  QUERY: TELEMETRY_PERMISSION_DECLARATIONS.TELEMETRY_QUERY.id,
};

/**
 * Permissions the APP owns that telemetry routes also require; the app must
 * declare them. `AI_USE`: the assistant spends an AI key (all-of with
 * `telemetry:query`). `SYSTEM_SETTINGS_READ`/`SYSTEM_SETTINGS_WRITE`: the
 * stack-agent routes (`/api/admin/telemetry/stack`) are deployment operations
 * gated like the rest of the system settings.
 *
 * @stability experimental
 */
export const TELEMETRY_HOST_PERMISSIONS: {
  /** `ai:use`: spend an AI key. */
  readonly AI_USE: 'ai:use';
  /** `system_settings:read`. */
  readonly SYSTEM_SETTINGS_READ: 'system_settings:read';
  /** `system_settings:write`. */
  readonly SYSTEM_SETTINGS_WRITE: 'system_settings:write';
} = {
  AI_USE: 'ai:use',
  SYSTEM_SETTINGS_READ: 'system_settings:read',
  SYSTEM_SETTINGS_WRITE: 'system_settings:write',
};
