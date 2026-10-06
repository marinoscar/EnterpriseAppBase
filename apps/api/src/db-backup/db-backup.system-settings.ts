// =============================================================================
// System settings namespace `databaseBackup` (issue #677; namespace #256, epic #254)
// =============================================================================
//
// A declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/system-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`.
// =============================================================================

import type { z } from 'zod';
import {
  systemDatabaseBackupPatchSchema,
  systemDatabaseBackupSchema,
  type SystemDatabaseBackupValue,
} from '../common/schemas/settings.schema';
import {
  databaseBackupSettingsPatchSchema,
  databaseBackupSettingsSchema,
} from '../settings/dto/system-settings-wire.schemas';
import { databaseBackupResponseSchema } from '../settings/dto/system-settings-response.schemas';
import type { SystemSettingsNamespace } from '../settings/registry/system-settings-namespace';

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

export const DATABASE_BACKUP_SYSTEM_SETTINGS = {
  key: 'databaseBackup',
  description: 'Database backup and restore policy: the schedule, retention, target provider, compression, rollback mode and node offload.',
  storedSchema: systemDatabaseBackupSchema,
  patchSchema: systemDatabaseBackupPatchSchema,
  putSchema: databaseBackupSettingsSchema,
  wirePatchSchema: databaseBackupSettingsPatchSchema,
  responseSchema: databaseBackupResponseSchema,
  defaults: DATABASE_BACKUP_SYSTEM_DEFAULTS,
  requiredOnPut: false,
  merge(current, patch) {
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
  },
} satisfies SystemSettingsNamespace<
  'databaseBackup',
  SystemDatabaseBackupValue,
  z.infer<typeof databaseBackupSettingsPatchSchema>
>;

declare module '../settings/registry/system-settings-namespace' {
  interface SystemSettingsNamespaces {
    /** Database backup/restore policy (#256, epic #254). REQUIRED for the reason `jobs` gives. */
    databaseBackup: SystemDatabaseBackupValue;
  }
  interface SystemSettingsNamespaceDeclarations {
    databaseBackup: typeof DATABASE_BACKUP_SYSTEM_SETTINGS;
  }
}
