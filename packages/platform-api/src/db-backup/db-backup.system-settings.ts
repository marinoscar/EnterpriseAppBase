// =============================================================================
// System settings namespace `databaseBackup` (issue #677; namespace #256, epic #254)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules (the schemas are
// `@marinoscar/platform-contract/db-backup`'s since #740). Registered by the
// app's system-settings manifest. Recipe: packages/platform-api/src/settings/README.md.
// =============================================================================

import {
  databaseBackupResponseSchema,
  databaseBackupSettingsPatchSchema,
  databaseBackupSettingsSchema,
  systemDatabaseBackupPatchSchema,
  systemDatabaseBackupSchema,
  type DatabaseBackupSettingsPatchInput,
  type SystemDatabaseBackupValue,
} from '@marinoscar/platform-contract/db-backup';
import type { SystemSettingsNamespace } from '../settings/index';

// Inert, like every operations namespace: backups ship disabled.
const DATABASE_BACKUP_SYSTEM_DEFAULTS: SystemDatabaseBackupValue = {
  enabled: false,
  frequency: 'daily',
  dayOfWeek: 0,
  dayOfMonth: 1,
  timeOfDay: '02:00',
  timezone: 'UTC',
  retentionCount: 7,
  // EMPTY MEANS "WHATEVER PROVIDER IS ACTIVE", and that is the only honest
  // default (#373, epic #372). This field is a PIN: a non-empty value must
  // equal `storage.provider` or every backup is a loud 400
  // (`db-backup/db-backup-storage.ts`), which is exactly what should happen
  // to a value an operator typed and then contradicted. It is exactly what
  // should NOT happen to a value they never typed — and shipping the literal
  // `'s3'` here did precisely that: once `storage.provider` became a live
  // setting, every deployment that selected R2 inherited a pin on `s3` and
  // failed EVERY backup, from `queueBackup`, `startBackup`, `runQueuedBackup`
  // and `PUT config` alike, on nobody's decision. Empty is inert in the same
  // sense as the rest of this block: it defers, it does not choose.
  storageProvider: '',
  runStaleMinutes: 120,
  compressionLevel: 6,
  restoreRollbackMode: 'retain_database',
  oldDatabaseRetentionHours: 48,
  // OFF, like `nodes.jobSecretBrokerEnabled` and for a related-but-distinct
  // reason (#352, epic #345): a fresh deployment does not ship its entire
  // database off the API server because somebody registered a worker node.
  // Both switches must be on, and the credential broker must report itself
  // usable, before `db.backup.run` is offered to a node at all.
  nodeOffloadEnabled: false,
};

/**
 * The `databaseBackup` PATCH merge: a field the patch names replaces the
 * stored one, an absent field is kept (`''` for `storageProvider` clears the
 * pin back to "whatever provider is active").
 *
 * @param current - the stored value.
 * @param patch - the PATCH body's `databaseBackup` branch, when present.
 * @returns the merged value.
 *
 * @stability experimental
 */
export function mergeDatabaseBackupSettings(
  current: SystemDatabaseBackupValue,
  patch?: DatabaseBackupSettingsPatchInput,
): SystemDatabaseBackupValue {
    return {
      enabled: patch?.enabled ?? current.enabled,
      frequency: patch?.frequency ?? current.frequency,
      dayOfWeek: patch?.dayOfWeek ?? current.dayOfWeek,
      dayOfMonth: patch?.dayOfMonth ?? current.dayOfMonth,
      timeOfDay: patch?.timeOfDay ?? current.timeOfDay,
      timezone: patch?.timezone ?? current.timezone,
      retentionCount: patch?.retentionCount ?? current.retentionCount,
      storageProvider: patch?.storageProvider ?? current.storageProvider,
      runStaleMinutes: patch?.runStaleMinutes ?? current.runStaleMinutes,
      compressionLevel: patch?.compressionLevel ?? current.compressionLevel,
      restoreRollbackMode: patch?.restoreRollbackMode ?? current.restoreRollbackMode,
      oldDatabaseRetentionHours: patch?.oldDatabaseRetentionHours ?? current.oldDatabaseRetentionHours,
      nodeOffloadEnabled: patch?.nodeOffloadEnabled ?? current.nodeOffloadEnabled,
    };
}

/**
 * The `databaseBackup` system-settings namespace (#256, epic #254): the
 * schedule, retention, target provider, compression, rollback mode and node
 * offload. Registered by the app's system settings manifest. Inert by default:
 * backups ship disabled.
 *
 * @stability experimental
 */
export const DATABASE_BACKUP_SYSTEM_SETTINGS = {
  /** The namespace key (permanent). */
  key: 'databaseBackup',
  /** What it holds. */
  description: 'Database backup and restore policy: the schedule, retention, target provider, compression, rollback mode and node offload.',
  /** The stored shape. */
  storedSchema: systemDatabaseBackupSchema,
  /** The stored partial. */
  patchSchema: systemDatabaseBackupPatchSchema,
  /** The PUT body's branch. */
  putSchema: databaseBackupSettingsSchema,
  /** The PATCH body's branch. */
  wirePatchSchema: databaseBackupSettingsPatchSchema,
  /** The GET response's branch. */
  responseSchema: databaseBackupResponseSchema,
  /** Inert: backups ship disabled. */
  defaults: DATABASE_BACKUP_SYSTEM_DEFAULTS,
  /** Optional in a PUT body. */
  requiredOnPut: false,
  /** The PATCH merge (`mergeDatabaseBackupSettings`). */
  merge: mergeDatabaseBackupSettings,
} satisfies SystemSettingsNamespace<'databaseBackup', SystemDatabaseBackupValue, DatabaseBackupSettingsPatchInput>;

declare module '../settings/registry/system-settings-namespace' {
  interface SystemSettingsNamespaces {
    /** Database backup/restore policy (#256, epic #254). REQUIRED for the reason `jobs` gives. */
    databaseBackup: SystemDatabaseBackupValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    /** The `databaseBackup` declaration. */
    databaseBackup: typeof DATABASE_BACKUP_SYSTEM_SETTINGS;
  }
}
