// =============================================================================
// Role Constants
// =============================================================================

export const ROLES = {
  ADMIN: 'admin',
  CONTRIBUTOR: 'contributor',
  VIEWER: 'viewer',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

// =============================================================================
// Permission Constants
// =============================================================================

export const PERMISSIONS = {
  // System settings
  SYSTEM_SETTINGS_READ: 'system_settings:read',
  SYSTEM_SETTINGS_WRITE: 'system_settings:write',

  // User settings
  USER_SETTINGS_READ: 'user_settings:read',
  USER_SETTINGS_WRITE: 'user_settings:write',

  // Users
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',

  // RBAC
  RBAC_MANAGE: 'rbac:manage',

  // Allowlist
  ALLOWLIST_READ: 'allowlist:read',
  ALLOWLIST_WRITE: 'allowlist:write',

  // Storage
  STORAGE_READ: 'storage:read',
  STORAGE_WRITE: 'storage:write',
  STORAGE_DELETE_ANY: 'storage:delete_any',

  // Jobs — the background queue (#256, epic #254)
  JOBS_READ: 'jobs:read',
  JOBS_WRITE: 'jobs:write',

  // Worker nodes — the fleet that executes those jobs (#256, epic #254).
  //
  // DELIBERATELY SPLIT FROM `jobs:*`, not folded into it. The Settings UI
  // Pattern (CLAUDE.md rule 3) requires a card's `permission` to be the exact
  // string the API controller enforces, so a Workers card gated on `jobs:read`
  // would be advertising a permission the nodes controller never checks — the
  // hub would hide or show the card on evidence unrelated to whether the
  // request behind it will be authorized. The two are also genuinely different
  // questions: "what work is queued" is operational, "which machines are
  // attached to this deployment" is closer to infrastructure inventory, and a
  // deployment may well want to grant one without the other.
  NODES_READ: 'nodes:read',
  NODES_WRITE: 'nodes:write',

  // Database backup (#256, epic #254).
  //
  // `:restore` IS A THIRD PERMISSION, not part of `:write`, because the two
  // are not the same act. Writing is routine scheduling — change the hour,
  // change how many copies are kept — and is reversible by writing again.
  // Restoring renames the live database and restarts the process: it is
  // destructive, it interrupts every session, and it is exactly the operation
  // an operator should have to be granted on purpose. Folding it into `:write`
  // would mean anyone allowed to adjust the backup schedule is also allowed to
  // roll the database back over the top of production.
  DB_BACKUP_READ: 'db_backup:read',
  DB_BACKUP_WRITE: 'db_backup:write',
  DB_BACKUP_RESTORE: 'db_backup:restore',
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// =============================================================================
// Default Role
// =============================================================================

export const DEFAULT_ROLE = ROLES.VIEWER;
