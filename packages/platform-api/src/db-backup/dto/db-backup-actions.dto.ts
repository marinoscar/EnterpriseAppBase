// =============================================================================
// What the three action routes answer with (issue #283, epic #254)
// =============================================================================
//
// Delete, cancel and download. Each returns a body rather than a bare `204`,
// and in each case the reason is the same: THE HONEST ANSWER HAS MORE THAN ONE
// SHAPE, and a status code cannot carry the difference.
//
// -----------------------------------------------------------------------------
// DELETE RETURNS `objectDeleted`, SO A MISSING OBJECT CANNOT STRAND A ROW
// -----------------------------------------------------------------------------
//
// The archive is deleted first and the row second — the reverse order would
// leave a multi-gigabyte object in the bucket that nothing points at, billed
// forever, because the row is the only index of what exists there. The same
// ordering, for the same reason, is in `db-backup-retention.service.ts`.
//
// But the object delete is BEST-EFFORT, and that is what this field reports. An
// object that is already gone — pruned by a bucket lifecycle rule, removed by
// hand, deleted by a previous attempt that failed after the object and before
// the row — must not make the row undeletable. Failing the request would leave
// an administrator staring at a row they cannot remove for a reason that is not
// their fault and that no retry will change. So the row goes, and
// `objectDeleted: false` says plainly that there was nothing in storage to
// remove (or that removing it did not work), which is exactly the fact an
// operator needs if they are reconciling a bucket against this table.
//
// -----------------------------------------------------------------------------
// CANCEL RETURNS AN OUTCOME, BECAUSE CANCELLATION IS PROCESS-LOCAL
// -----------------------------------------------------------------------------
//
// A dump is stopped by signalling a CHILD PROCESS, and only the API replica
// that spawned it holds that handle. A run started on another replica genuinely
// cannot be stopped from here. `DatabaseBackupRunnerService.cancel` already
// says so — it returns a discriminated result rather than a `boolean` — and
// this DTO's whole job is to carry that distinction to the client instead of
// flattening it into a 200 that means "cancelled" when it does not.
//
// See `DatabaseBackupAdminService.cancelRun` for why `not_running_here` is a
// 200 with an honest body rather than a 409 or a 500.
// =============================================================================

import { createZodDto } from 'nestjs-zod';

import {
  backupDownloadUrlSchema,
  cancelBackupResultSchema,
  deleteBackupResultSchema,
} from '@marinoscar/platform-contract/db-backup';

// The wire shapes live in `@marinoscar/platform-contract/db-backup` (#740);
// re-exported so every importer of this file keeps its import.
export {
  CANCEL_OUTCOMES,
  backupDownloadUrlSchema,
  cancelBackupResultSchema,
  deleteBackupResultSchema,
} from '@marinoscar/platform-contract/db-backup';
/** @stability experimental */
export type {
  BackupDownloadUrl,
  CancelBackupResult,
  DeleteBackupResult,
} from '@marinoscar/platform-contract/db-backup';

// ---------------------------------------------------------------------------
// DELETE runs/:id
// ---------------------------------------------------------------------------

/** @stability experimental */
export class DeleteBackupResultDto extends createZodDto(deleteBackupResultSchema) {}

// ---------------------------------------------------------------------------
// POST runs/:id/cancel
// ---------------------------------------------------------------------------

/** @stability experimental */
export class CancelBackupResultDto extends createZodDto(cancelBackupResultSchema) {}

// ---------------------------------------------------------------------------
// GET runs/:id/download
// ---------------------------------------------------------------------------

/** @stability experimental */
export class BackupDownloadUrlDto extends createZodDto(backupDownloadUrlSchema) {}

