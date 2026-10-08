// =============================================================================
// Database backup: the `databaseBackup` system-settings namespace's schemas
// (issue #740, PP-8.7)
// =============================================================================
//
// The five schemas the namespace declaration of
// `@marinoscar/platform-api/db-backup` (`DATABASE_BACKUP_SYSTEM_SETTINGS`) is
// built from: the stored value and its partial, the PUT and PATCH wire
// branches, and the GET response branch. Moved verbatim (design comments
// included) from the reference app's `common/schemas/settings.schema.ts`,
// `system-settings-wire.schemas.ts` and `system-settings-response.schemas.ts`,
// which re-export them. Every bound is unchanged, so the OpenAPI document of
// `/api/system-settings` is too.
// =============================================================================

import { z } from 'zod';

import { BACKUP_TIME_OF_DAY_PATTERN, type DbBackupEnum } from './constants.js';

/**
 * Database backup and restore policy (`databaseBackup`).
 *
 * `dayOfWeek` and `dayOfMonth` are BOTH always present and both always valid,
 * whatever `frequency` says. The alternative — a discriminated union keyed on
 * `frequency` — would mean switching a schedule from weekly to monthly and
 * back loses the day the operator had chosen, and would make a PATCH that
 * changes only `frequency` invalid unless it also carried the other field.
 * Storing an inert-but-remembered value is the cheaper mistake.
 *
 * `dayOfMonth` stops at 28 rather than 31 so that "monthly" means every month:
 * a schedule pinned to the 30th silently skips February.
 *
 * `restoreRollbackMode` decides what happens to the database a restore
 * displaced — `retain_database` keeps it (renamed, reachable, deleted later by
 * `oldDatabaseRetentionHours`), `drop_database` does not. The default is to
 * retain, because the failure mode of retaining is disk and the failure mode
 * of dropping is a restore from the wrong dump with nothing to go back to.
 *
 * `nodeOffloadEnabled` (#352, epic #345) decides whether `db.backup.run` may be
 * claimed by a WORKER NODE at all. DEFAULT FALSE, and it is deliberately a
 * SECOND switch rather than a reuse of `nodes.jobSecretBrokerEnabled`, because
 * the two answer different questions and a deployment can genuinely want one
 * without the other:
 *
 *   - `nodes.jobSecretBrokerEnabled` — MAY THE BROKER ISSUE ANYTHING AT ALL?
 *     A statement about the fleet: are these machines inside the trust
 *     boundary for short-lived credentials of any kind?
 *   - `databaseBackup.nodeOffloadEnabled` — MAY *THIS* TYPE LEAVE THE SERVER?
 *     A statement about one workload: is dumping the whole database on a
 *     machine that is not the API server what this deployment wants, given
 *     that the node needs a network route to PostgreSQL and the archive's
 *     bytes will cross whatever network sits between them?
 *
 * Collapsing them would mean enabling brokering for any future type — a
 * fork's own `nodeSecretBroker` — silently enables shipping the database
 * dump off-box too, which is not a decision anybody made. Both must be true,
 * AND the broker must report itself usable, before the type is offered to a
 * node; see `NodesService.nodeEligibleTypes`. Off (either one) means the type
 * is withheld from the claim and the in-process worker takes the backup, which
 * is exactly what happened before node offload existed.
 *
 * `storageProvider` CARRIES NO `.min(1)`, AND ITS DEFAULT IS THE EMPTY STRING
 * (#373, epic #372). Empty is the one spelling of "unset" — the same decision
 * the `storage` namespace below makes and for the same reason; it is not
 * nullable and not optional-in-storage, so no consumer ever has to ask "absent,
 * or empty?" and get two answers. Empty means "whatever provider is active",
 * which is the only default a template repository can ship honestly: a literal
 * would have to be a guess at somebody else's deployment, and `isUsableStorage
 * Provider` (`db-backup/db-backup-storage.ts`) turns a disagreement with the
 * live `storage.provider` into a loud 400. Shipping `'s3'` here meant every
 * deployment that selected R2 failed EVERY backup on a value nobody chose —
 * a default the operator never typed must not be able to redirect or block
 * their backups. What did NOT change is the check: a value an operator DID
 * type must still equal the active provider exactly, because a backup landing
 * somewhere other than where the settings page says it lands is only ever
 * discovered during a restore. The bound stays 64 — a provider id, not prose —
 * and the comparison trims, so stored whitespace is still "unset".
 *
 * @stability stable
 */
export const systemDatabaseBackupSchema = z.object({
  /** Enabled. */
  enabled: z.boolean(),
  /** Frequency. */
  frequency: (z.enum(['daily', 'weekly', 'monthly']) as z.ZodEnum<DbBackupEnum<['daily', 'weekly', 'monthly']>>),
  /** Day of week. */
  dayOfWeek: z.number().int().min(0).max(6),
  /** Day of month. */
  dayOfMonth: z.number().int().min(1).max(28),
  /** Time of day: 24-hour `HH:MM`, zero-padded. */
  timeOfDay: z
    .string()
    .regex(BACKUP_TIME_OF_DAY_PATTERN, 'Expected a 24-hour HH:MM time'),
  /** Timezone. */
  timezone: z.string().min(1).max(64),
  /** Retention count. */
  retentionCount: z.number().int().min(1).max(365),
  /**
   * NO `.min(1)`: the empty string is the one spelling of "unset", and it is
   * the SHIPPED DEFAULT. See the block comment above.
   */
  storageProvider: z.string().max(64),
  /** Run stale minutes. */
  runStaleMinutes: z.number().int().min(1).max(10080),
  /** Compression level. */
  compressionLevel: z.number().int().min(0).max(9),
  /** Restore rollback mode. */
  restoreRollbackMode: (z.enum(['retain_database', 'drop_database']) as z.ZodEnum<DbBackupEnum<['retain_database', 'drop_database']>>),
  /** Old database retention hours. */
  oldDatabaseRetentionHours: z.number().int().min(1).max(8760),
  /** Node offload enabled. */
  nodeOffloadEnabled: z.boolean(),
});

/**
 * The stored `databaseBackup` value.
 *
 * @stability stable
 */
export type SystemDatabaseBackupValue = z.infer<
  typeof systemDatabaseBackupSchema
>;

/**
 * The stored partial of `databaseBackup`: every field optional, every bound
 * the stored schema's.
 *
 * @stability stable
 */
export const systemDatabaseBackupPatchSchema = z.object({
  /** Enabled. */
  enabled: z.boolean().optional(),
  /** Frequency. */
  frequency: (z.enum(['daily', 'weekly', 'monthly']) as z.ZodEnum<DbBackupEnum<['daily', 'weekly', 'monthly']>>).optional(),
  /** Day of week. */
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  /** Day of month. */
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  /** Time of day: 24-hour `HH:MM`, zero-padded. */
  timeOfDay: z
    .string()
    .regex(BACKUP_TIME_OF_DAY_PATTERN, 'Expected a 24-hour HH:MM time')
    .optional(),
  /** Timezone. */
  timezone: z.string().min(1).max(64).optional(),
  /** Retention count. */
  retentionCount: z.number().int().min(1).max(365).optional(),
  /**
   * No `.min(1)`, matching `systemDatabaseBackupSchema`: `""` CLEARS the pin
   * back to "whatever provider is active" (absent is how a caller says "leave
   * it alone"), which is the only way an operator can un-pin through the API.
   * Rejecting `""` here would make the shipped default unreachable by the very
   * endpoint that edits it.
   */
  storageProvider: z.string().max(64).optional(),
  /** Run stale minutes. */
  runStaleMinutes: z.number().int().min(1).max(10080).optional(),
  /** Compression level. */
  compressionLevel: z.number().int().min(0).max(9).optional(),
  /** What a restore does with the database it displaced. */
  restoreRollbackMode: (z.enum(['retain_database', 'drop_database']) as z.ZodEnum<DbBackupEnum<['retain_database', 'drop_database']>>).optional(),
  /** Old database retention hours. */
  oldDatabaseRetentionHours: z.number().int().min(1).max(8760).optional(),
  /** Node offload enabled. */
  nodeOffloadEnabled: z.boolean().optional(),
});


/**
 * The `databaseBackup` branch of a `PUT /api/system-settings` body.
 *
 * @stability stable
 */
export const databaseBackupSettingsSchema = z.object({
  /** Enabled. */
  enabled: z.boolean(),
  /** Frequency. */
  frequency: (z.enum(['daily', 'weekly', 'monthly']) as z.ZodEnum<DbBackupEnum<['daily', 'weekly', 'monthly']>>),
  /** Day of week. */
  dayOfWeek: z.number().int().min(0).max(6),
  /** Day of month. */
  dayOfMonth: z.number().int().min(1).max(28),
  /** Time of day: 24-hour `HH:MM`, zero-padded. */
  timeOfDay: z
    .string()
    .regex(BACKUP_TIME_OF_DAY_PATTERN, 'Expected a 24-hour HH:MM time'),
  /** Timezone. */
  timezone: z.string().min(1).max(64),
  /** Retention count. */
  retentionCount: z.number().int().min(1).max(365),
  /**
   * No `.min(1)`: `""` is the one spelling of "unset" and is the SHIPPED
   * DEFAULT — it means "whatever provider `storage.provider` names right now".
   * A non-empty value must equal the active provider or the write is a loud
   * 400 (`DatabaseBackupRunnerService.assertStorageProviderUsable`); that check
   * is unchanged. Only the default moved, because a provider id the operator
   * never chose must not be able to redirect or block their backups. See
   * `common/schemas/settings.schema.ts` for the full argument.
   */
  storageProvider: z.string().max(64),
  /** Run stale minutes. */
  runStaleMinutes: z.number().int().min(1).max(10080),
  /** Compression level. */
  compressionLevel: z.number().int().min(0).max(9),
  /** Restore rollback mode. */
  restoreRollbackMode: (z.enum(['retain_database', 'drop_database']) as z.ZodEnum<DbBackupEnum<['retain_database', 'drop_database']>>),
  /** Old database retention hours. */
  oldDatabaseRetentionHours: z.number().int().min(1).max(8760),
  /** Node offload enabled. */
  nodeOffloadEnabled: z.boolean(),
});

/**
 * The `databaseBackup` branch of a `PATCH /api/system-settings` body: field by field optional.
 *
 * @stability stable
 */
export const databaseBackupSettingsPatchSchema = z.object({
  /** Enabled. */
  enabled: z.boolean().optional(),
  /** Frequency. */
  frequency: (z.enum(['daily', 'weekly', 'monthly']) as z.ZodEnum<DbBackupEnum<['daily', 'weekly', 'monthly']>>).optional(),
  /** Day of week. */
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  /** Day of month. */
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  /** Time of day: 24-hour `HH:MM`, zero-padded. */
  timeOfDay: z
    .string()
    .regex(BACKUP_TIME_OF_DAY_PATTERN, 'Expected a 24-hour HH:MM time')
    .optional(),
  /** Timezone. */
  timezone: z.string().min(1).max(64).optional(),
  /** Retention count. */
  retentionCount: z.number().int().min(1).max(365).optional(),
  /**
   * No `.min(1)`, matching the PUT schema above: `""` CLEARS the pin back
   * to "whatever provider is active", absent leaves it alone. Rejecting
   * `""` would make the shipped default unreachable by the endpoint that
   * edits it.
   */
  storageProvider: z.string().max(64).optional(),
  /** Run stale minutes. */
  runStaleMinutes: z.number().int().min(1).max(10080).optional(),
  /** Compression level. */
  compressionLevel: z.number().int().min(0).max(9).optional(),
  /** What a restore does with the database it displaced. */
  restoreRollbackMode: (z.enum(['retain_database', 'drop_database']) as z.ZodEnum<DbBackupEnum<['retain_database', 'drop_database']>>).optional(),
  /** Old database retention hours. */
  oldDatabaseRetentionHours: z.number().int().min(1).max(8760).optional(),
  /** Node offload enabled. */
  nodeOffloadEnabled: z.boolean().optional(),
});

/**
 * The `databaseBackup` branch of the `GET /api/system-settings` response.
 *
 * @stability stable
 */
export const databaseBackupResponseSchema = z.object({
  /** Enabled. */
  enabled: z.boolean(),
  /** Frequency. */
  frequency: (z.enum(['daily', 'weekly', 'monthly']) as z.ZodEnum<DbBackupEnum<['daily', 'weekly', 'monthly']>>),
  /** Day of week. */
  dayOfWeek: z.number(),
  /** Day of month. */
  dayOfMonth: z.number(),
  /** Time of day. */
  timeOfDay: z.string(),
  /** Timezone. */
  timezone: z.string(),
  /** Retention count. */
  retentionCount: z.number(),
  /** Storage provider. */
  storageProvider: z.string(),
  /** Run stale minutes. */
  runStaleMinutes: z.number(),
  /** Compression level. */
  compressionLevel: z.number(),
  /** Restore rollback mode. */
  restoreRollbackMode: (z.enum(['retain_database', 'drop_database']) as z.ZodEnum<DbBackupEnum<['retain_database', 'drop_database']>>),
  /** Old database retention hours. */
  oldDatabaseRetentionHours: z.number(),
  /** Node offload enabled. */
  nodeOffloadEnabled: z.boolean(),
});

/**
 * The `databaseBackup` PATCH body's branch, parsed.
 *
 * @stability stable
 */
export type DatabaseBackupSettingsPatchInput = z.infer<typeof databaseBackupSettingsPatchSchema>;
