// =============================================================================
// One `database_backup_runs` row, as the admin API publishes it
// =============================================================================
// (issue #283, epic #254)
//
// This schema describes the JSON an administrator receives, NOT the Prisma
// model, and the gap between the two is the whole reason this file exists.
//
// -----------------------------------------------------------------------------
// ⚠ `bytesWritten` AND `sizeBytes` ARE `BigInt` COLUMNS, AND `JSON.stringify`
// REFUSES `bigint` OUTRIGHT
// -----------------------------------------------------------------------------
//
// `JSON.stringify(1n)` does not produce `1`, does not produce `"1"`, and does
// not produce `null`: it throws `TypeError: Do not know how to serialize a
// BigInt`. So a handler that returns a raw Prisma row from this table is a
// handler that throws AT SEND TIME — after the query ran, after the status code
// was chosen, inside the framework's serializer — which is the single most
// confusing place for an error to come from.
//
// The failure mode that makes this worth a header rather than a line comment is
// that IT IS INVISIBLE TO AN ORDINARY UNIT TEST. A spec that calls the service
// and object-compares the result passes happily: `expect(run.sizeBytes).toBe(
// 12n)` is true, `toEqual` on the whole row is true, and nothing in the
// assertion path ever serialises anything. The defect only appears when a real
// response is turned into bytes. That is why {@link toRunDto} exists as ONE
// function that every path returning a run goes through — the list, the single
// get, the manual trigger — and why `test/db-backup/db-backup-admin.integration
// .spec.ts` drives a run with genuinely large `BigInt` values through the real
// router and asserts on the SERIALISED body.
//
// The columns are `BigInt` for a good reason and are not going to stop being
// one: a dump crossing 2 GiB is ordinary, and a signed 32-bit column overflows
// at 2147483647 — on the largest backups, which are exactly the deployments
// this feature exists for. See `docs/specs/database-backup.md`,
// "Model: `database_backup_runs`".
//
// THEY ARE PUBLISHED AS DECIMAL STRINGS, not as numbers. `Number(9_007_199_254
// _740_993n)` is silently wrong — JSON's number type is a double, and a byte
// count above 2^53 rounds. A string is exact, is what every JSON API that
// carries 64-bit integers does, and forces a client to make its own decision
// about precision rather than having one made for it invisibly.
//
// -----------------------------------------------------------------------------
// TIMESTAMPS ARE CONVERTED EXPLICITLY TOO
// -----------------------------------------------------------------------------
//
// The serializer would turn a `Date` into an ISO string on its own, exactly as
// it does for `jobs/dto/job-response.dto.ts`. They are converted here anyway,
// because the point of {@link toRunDto} is that WHAT IT RETURNS IS WHAT GOES ON
// THE WIRE — a projection with no framework magic left in it. That property is
// what lets a spec `JSON.stringify` its output directly and have proved
// something about the response.
//
// -----------------------------------------------------------------------------
// THE RESTORE COLUMNS ARE PUBLISHED BY #286, AND NOT BEFORE
// -----------------------------------------------------------------------------
//
// `restoreStatus`, `restoreError`, `restoredAt`, `restoredById`,
// `restoreScratchDb`, `restoreOldDb`, `swappedAt` and `preRestoreBackupId` sat
// in `schema.prisma` unpublished through #283 and #285 for a stated reason:
// eight fields whose only possible value was `null` would have been a
// documented contract a client could not distinguish from "this build does not
// implement restore".
//
// #286 IS THE ISSUE THAT MAKES THEM MEAN SOMETHING, and it does so by
// necessity rather than by choice: `POST runs/:id/restore` returns as soon as
// the cheap pre-flight gates have run and the restore then takes HOURS, so the
// contract it publishes is "poll `GET runs/{id}`". That promise is unkeepable
// while the polling endpoint does not carry `restoreStatus` — the caller would
// be told to watch a field that is not in the response. So they are published
// here, in the ONE projection every run path already goes through, rather than
// hand-rolled into the restore routes' own bodies where the list and the single
// get could not see them.
// =============================================================================

import { z } from 'zod';

import { BACKUP_STATUSES, BACKUP_TRIGGERS, RESTORE_STATUSES, type DbBackupEnum } from './constants.js';

/**
 * One `database_backup_runs` row as the admin API publishes it (both `BigInt` columns as decimal strings).
 *
 * @stability stable
 */
export const backupRunSchema = z.object({
  /** Id. */
  id: z.uuid(),

  /** Status. */
  status: (z.enum(BACKUP_STATUSES) as z.ZodEnum<DbBackupEnum<typeof BACKUP_STATUSES>>),

  /** Why this run exists. `pre_restore` runs are taken by #285, not by a person. */
  trigger: (z.enum(BACKUP_TRIGGERS) as z.ZodEnum<DbBackupEnum<typeof BACKUP_TRIGGERS>>),

  /**
   * Live progress, rewritten by the heartbeat roughly every 20 seconds while a
   * dump streams; the final byte count once the run settles. Kept on a FAILED
   * run rather than reset, because how far a dump got is the difference between
   * "the database refused the connection" and "it died at 40 GB".
   *
   * A DECIMAL STRING — see this file's header.
   */
  bytesWritten: z.string().regex(/^\d+$/),

  /**
   * The archive's final size, written once at completion. `"0"` on any run that
   * has not completed: it is the answer to "how big is the object that exists",
   * and until verification passes there is no object worth naming a size for.
   *
   * A DECIMAL STRING — see this file's header.
   */
  sizeBytes: z.string().regex(/^\d+$/),

  /**
   * Where the archive is. The whole triple is recorded on the row rather than
   * derived on read, so a bucket rename or a provider swap cannot make an old
   * archive unlocatable.
   */
  storageProvider: z.string(),
  /** Storage key. */
  storageKey: z.string(),
  /** Bucket. */
  bucket: z.string(),

  /** Always `custom` today: `pg_dump -Fc`, the only format `pg_restore` can list and filter. */
  format: z.string(),

  /** SHA-256 of the bytes that were streamed to storage. `null` until the run completes. */
  checksumSha256: z.string().nullable(),

  /**
   * When the uploaded object was streamed back and `pg_restore --list` read a
   * non-empty table of contents from it.
   *
   * THE FIELD WORTH READING FIRST. A `completed` run with a `verifiedAt` is a
   * backup that has been proven restorable-shaped at least once; nothing else
   * on this row makes that claim.
   */
  verifiedAt: z.iso.datetime().nullable(),

  /** Provenance, all best-effort: none of the four may fail a backup. */
  dbVersion: z.string().nullable(),
  /** App version. */
  appVersion: z.string().nullable(),
  /**
   * The newest applied migration — which SCHEMA this archive contains, and so
   * whether the code that is running will understand what comes back.
   */
  migrationName: z.string().nullable(),
  /**
   * The `pg_dump` client that wrote the archive (#352).
   *
   * `null` for every run taken before the column existed, and for any run
   * whose `--version` could not be read. It earns its place on the node path:
   * there the binary lives on a machine this API cannot inspect, and
   * `pg_restore` cannot read an archive written by a NEWER `pg_dump` — so this
   * is the field that answers "can the machine I am restoring on read this
   * file" before the restore rather than during it.
   */
  pgDumpVersion: z.string().nullable(),

  /** Why the run failed, verbatim. `null` on a run that has not failed. */
  lastError: z.string().nullable(),

  /** Started at. */
  startedAt: z.iso.datetime().nullable(),
  /** Finished at. */
  finishedAt: z.iso.datetime().nullable(),

  /**
   * The last progress write. A `running` row whose heartbeat has stopped
   * advancing is what #282's sweep marks `stale`.
   */
  lastHeartbeatAt: z.iso.datetime().nullable(),

  /**
   * The administrator who asked, when a person did.
   *
   * `null` for a `scheduled` run — a timer has no user, and inventing one would
   * put a name on an action nobody took.
   */
  createdById: z.uuid().nullable(),

  // -------------------------------------------------------------------------
  // The restore columns (#285's work, published by #286's endpoints)
  // -------------------------------------------------------------------------

  /**
   * ⚠ THE PROGRESS FIELD FOR A RESTORE, and the one `POST runs/:id/restore`
   * tells its caller to poll.
   *
   * `null` on every run nobody has ever restored, which is almost all of them.
   * Once a restore starts it walks `restoring` → `verifying` → `swapping` →
   * `completed`, or stops at `failed`; `rolled_back` is a restore that was
   * swapped in and then undone.
   *
   * `restoring` covers everything from the archive download to the last byte
   * `pg_restore` writes — the phase measured in hours — because a `pg_restore`
   * in flight reports nothing a caller could poll and inventing finer states
   * that all mean "still restoring" would be dishonest precision.
   *
   * ⚠ THE SWAP ENDS IN `process.exit(0)`. A poller will therefore usually see
   * `swapping` and then a connection error, and read `completed` only after the
   * supervisor has restarted the process. That is success, not failure — see
   * `docs/specs/database-restore.md`, "Migration roll-forward and exit".
   */
  restoreStatus: (z.enum(RESTORE_STATUSES) as z.ZodEnum<DbBackupEnum<typeof RESTORE_STATUSES>>).nullable(),

  /** Why a restore failed, verbatim. `null` on a restore that has not failed. */
  restoreError: z.string().nullable(),

  /** When the restore finished. `null` while it is still running. */
  restoredAt: z.iso.datetime().nullable(),

  /** The administrator who asked for the restore. `null` for an internal delegation. */
  restoredById: z.uuid().nullable(),

  /**
   * The database the archive was replayed into, before the swap renamed it into
   * place. Recorded so a failed restore leaves a name a human can drop.
   */
  restoreScratchDb: z.string().nullable(),

  /**
   * What the live database was renamed to at the swap.
   *
   * ⚠ IN `retain_database` MODE THIS IS THE WAY BACK. `POST runs/:id/rollback`
   * renames exactly this database back into place — in seconds — for as long as
   * it survives `databaseBackup.oldDatabaseRetentionHours`. `null` once the
   * retention sweep has dropped it, which is precisely when a rollback answers
   * `unavailable`.
   */
  restoreOldDb: z.string().nullable(),

  /** When the two renames completed. The moment the deployment changed databases. */
  swappedAt: z.iso.datetime().nullable(),

  /**
   * The `pre_restore` safety backup taken immediately before this restore's
   * swap, when one was taken.
   *
   * ⚠ IN `pre_restore_dump` MODE THIS IS THE WAY BACK, and it is the run a
   * rollback's `restore_started` mode tells you to poll — not this one. `null`
   * in `retain_database` mode, where the retained database serves that purpose
   * far more cheaply.
   */
  preRestoreBackupId: z.uuid().nullable(),

  /** Created at. */
  createdAt: z.iso.datetime(),
  /** Updated at. */
  updatedAt: z.iso.datetime(),
});

/**
 * The exact object shape the API's `toRunDto` produces, and therefore the wire shape.
 *
 * @stability stable
 */
export type BackupRunResponse = z.infer<typeof backupRunSchema>;
