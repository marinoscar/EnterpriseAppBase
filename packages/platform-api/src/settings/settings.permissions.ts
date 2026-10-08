// =============================================================================
// Settings permissions (issue #676, PP-1.4; packaged by #733)
// =============================================================================
//
// Pure data: the slice's permissions and their default role grants. The app
// registers them with its own permission registry (the reference app:
// `common/permissions/permission.manifest.ts`, which also derives
// `PERMISSIONS` from them), and the seed derives the rows from it. The
// strings never change: they are rows in `permissions` and the exact strings
// the routes (and the settings cards) enforce.
//
//   system_settings:read|write  SYSTEM scope: the deployment-wide document
//   user_settings:read|write    ORG scope (#723): a user's own settings, held
//                               through every org role
//   org_settings:read|write     ORG scope (#733): the active organization's
//                               overrides, held through `org_admin`
// =============================================================================

/**
 * One permission the settings slice declares, in the shape an app's
 * permission registry takes.
 *
 * @typeParam Id - the permission string.
 *
 * @stability experimental
 */
export interface SettingsPermissionDeclaration<Id extends string = string> {
  /** `'<resource>:<action>'`: the exact string the slice's routes enforce. */
  readonly id: Id;
  /** Seeded into `permissions.description`. */
  readonly description: string;
  /** `'system'` or `'org'`; every role in `defaultGrants` has the same scope. */
  readonly scope: 'system' | 'org';
  /** Role ids seeded into `role_permissions`; the seed only adds grants. */
  readonly defaultGrants: readonly string[];
}

/**
 * The system and user settings permissions (`system_settings:read|write`,
 * system scope, `admin`; `user_settings:read|write`, org scope, every org
 * role), keyed by the `PERMISSIONS` constant name the reference app derives
 * from them. Register them with the app's permission registry.
 *
 * @example
 * ```ts
 * registerPermissions(SETTINGS_PERMISSIONS);
 * ```
 *
 * @stability stable
 */
export const SETTINGS_PERMISSIONS: {
  /** `system_settings:read`: read the deployment-wide settings. */
  readonly SYSTEM_SETTINGS_READ: SettingsPermissionDeclaration<'system_settings:read'>;
  /** `system_settings:write`: change them. */
  readonly SYSTEM_SETTINGS_WRITE: SettingsPermissionDeclaration<'system_settings:write'>;
  /** `user_settings:read`: read one's own settings. */
  readonly USER_SETTINGS_READ: SettingsPermissionDeclaration<'user_settings:read'>;
  /** `user_settings:write`: change them. */
  readonly USER_SETTINGS_WRITE: SettingsPermissionDeclaration<'user_settings:write'>;
} = {
  // System settings
  SYSTEM_SETTINGS_READ: {
    id: 'system_settings:read',
    description: 'Read system settings',
    scope: 'system',
    defaultGrants: ['admin'],
  },
  SYSTEM_SETTINGS_WRITE: {
    id: 'system_settings:write',
    description: 'Modify system settings',
    scope: 'system',
    defaultGrants: ['admin'],
  },

  // User settings. ORG scope (issue #723): held through the membership role,
  // so the system `admin` role no longer carries them; an administrator's
  // `org_admin` membership does.
  USER_SETTINGS_READ: {
    id: 'user_settings:read',
    description: 'Read own user settings',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
  USER_SETTINGS_WRITE: {
    id: 'user_settings:write',
    description: 'Modify own user settings',
    scope: 'org',
    defaultGrants: ['org_admin', 'contributor', 'viewer'],
  },
};

/**
 * The organization settings permissions (#733): `org_settings:read` and
 * `org_settings:write`, ORG scope, granted to `org_admin` (in single-org mode
 * that is the system administrator's membership role). They gate
 * `GET` / `PATCH /api/org-settings`; each namespace's own
 * `org.readPermission` / `org.writePermission` then gates its fields inside
 * the handler. Registered AFTER every existing declaration (append-only).
 *
 * @example
 * ```ts
 * registerPermissions(ORG_SETTINGS_PERMISSIONS);
 * ```
 *
 * @stability experimental
 */
export const ORG_SETTINGS_PERMISSIONS: {
  /** `org_settings:read`: read the active organization's settings overrides. */
  readonly ORG_SETTINGS_READ: SettingsPermissionDeclaration<'org_settings:read'>;
  /** `org_settings:write`: change them. */
  readonly ORG_SETTINGS_WRITE: SettingsPermissionDeclaration<'org_settings:write'>;
} = {
  ORG_SETTINGS_READ: {
    id: 'org_settings:read',
    description: "Read the active organization's settings overrides",
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
  ORG_SETTINGS_WRITE: {
    id: 'org_settings:write',
    description: "Modify the active organization's settings overrides",
    scope: 'org',
    defaultGrants: ['org_admin'],
  },
};
