// =============================================================================
// The backup policy, read and written (issue #283, epic #254)
// =============================================================================
//
// One settings namespace (`databaseBackup`) seen from two directions: what an
// administrator sends to change it, and what they get back to look at.
//
// -----------------------------------------------------------------------------
// THE REQUEST SCHEMA IS `systemDatabaseBackupPatchSchema`, IMPORTED AND NOT
// RE-DECLARED
// -----------------------------------------------------------------------------
//
// Every bound in it — `compressionLevel` 0-9, `retentionCount` 1-365,
// `timeOfDay` matching `BACKUP_TIME_OF_DAY_PATTERN`, `dayOfMonth` stopping at
// 28 so that "monthly" never skips February — is already stated once in
// `common/schemas/settings.schema.ts`, and `PUT /api/system-settings` already
// enforces exactly that schema over exactly this namespace. A second copy here
// would be two schemas over one column, and the copy that drifts is always the
// one nobody is looking at: the settings page would accept a value this route
// refuses, or worse, this route would accept one the settings page refuses and
// write it to the same JSONB.
//
// This is the same argument `db-backup-storage.ts` makes for having ONE
// storage-provider rule shared by the write path and the run path.
//
// EVERY FIELD IS OPTIONAL, which is what makes the route a partial update in
// the sense the issue asks for: `{ "enabled": true }` is a legal body. An
// administrator changing the hour must not have to echo back twelve fields they
// did not touch — a form that re-sends everything is a form that silently
// reverts whatever another admin changed while it was open.
//
// -----------------------------------------------------------------------------
// THE RESPONSE IS THE POLICY PLUS TWO COMPUTED FIELDS
// -----------------------------------------------------------------------------
//
// `nextRunAt` and `activeRunId` are not stored anywhere and are not settings.
// They are here because the question an administrator actually has on this
// screen is not "what did I save" but "is this going to do what I meant, and is
// something happening right now" — and both were previously unanswerable
// without waiting a day to find out.
//
// See `DatabaseBackupAdminService.getConfig` for why `nextRunAt` is computed
// rather than stored, and why it is `null` in two quite different situations.
// =============================================================================

import { createZodDto } from 'nestjs-zod';

import {
  databaseBackupConfigSchema,
  updateDatabaseBackupConfigSchema,
} from '@marinoscar/platform-contract/db-backup';

// The wire shapes live in `@marinoscar/platform-contract/db-backup` (#740);
// re-exported so every importer of this file keeps its import.
export {
  RESTORE_UNAVAILABLE_REASONS,
  databaseBackupConfigSchema,
  updateDatabaseBackupConfigSchema,
} from '@marinoscar/platform-contract/db-backup';
/** @stability experimental */
export type {
  DatabaseBackupConfigResponse,
  UpdateDatabaseBackupConfig,
} from '@marinoscar/platform-contract/db-backup';

/** @stability experimental */
export class UpdateDatabaseBackupConfigDto extends createZodDto(
  updateDatabaseBackupConfigSchema
) {}

/** @stability experimental */
export class DatabaseBackupConfigDto extends createZodDto(databaseBackupConfigSchema) {}

