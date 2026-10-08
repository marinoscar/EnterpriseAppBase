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

import type { DatabaseBackupRun, DatabaseBackupStatus, DatabaseBackupTrigger } from '../data/db-backup-db';
import { createZodDto } from 'nestjs-zod';

import {
  RESTORE_STATUSES,
  backupRunSchema,
  type BackupRunResponse,
  type BackupStatusName,
  type BackupTriggerName,
  type RestoreStatusName,
} from '@marinoscar/platform-contract/db-backup';

// The wire shapes live in `@marinoscar/platform-contract/db-backup` (#740);
// re-exported so every importer of this file keeps its import.
export {
  ACTIVE_BACKUP_STATUSES,
  BACKUP_STATUSES,
  BACKUP_TRIGGERS,
  RESTORE_STATUSES,
  backupRunSchema,
} from '@marinoscar/platform-contract/db-backup';
/** @stability experimental */
export type {
  BackupRunResponse,
  BackupStatusName,
  BackupTriggerName,
  RestoreStatusName,
} from '@marinoscar/platform-contract/db-backup';

/**
 * `never` unless every member of `Enum` appears in `Listed`.
 *
 * No runtime form, so the check costs nothing at import time.
 */
type Exhaustive<Enum extends string, Listed extends string> = [
  Exclude<Enum, Listed>,
] extends [never]
  ? true
  : never;

// Fails to compile if `schema.prisma` gains a status or a trigger the tuples
// above do not list.
/** @stability experimental */
export type BackupStatusesAreExhaustive = Exhaustive<DatabaseBackupStatus, BackupStatusName>;
/** @stability experimental */
export type BackupTriggersAreExhaustive = Exhaustive<DatabaseBackupTrigger, BackupTriggerName>;

/** @stability experimental */
export class DatabaseBackupRunDto extends createZodDto(backupRunSchema) {}

/** A `Date` as an ISO string, preserving `null`. */
function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * THE one row-to-response projection.
 *
 * ⚠ EVERY path that returns a run goes through this function — the list, the
 * single get, the manual trigger. That is not tidiness: it is the only thing
 * standing between a `BigInt` column and a `TypeError` thrown inside the
 * framework's serializer. A second, hand-rolled projection anywhere would work
 * perfectly in every unit test and fail on the first real request, which is
 * exactly the header's argument.
 *
 * It takes the whole Prisma row rather than a narrowed `select`, so adding a
 * column to `schema.prisma` cannot silently change what this returns: the
 * response is the list of properties written out below and nothing else.
 *
 * @stability experimental
 */
export function toRunDto(run: DatabaseBackupRun): BackupRunResponse {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,

    // The two BigInts. `.toString()` on a `bigint` is exact at any magnitude —
    // unlike `Number()`, which starts rounding above 2^53.
    bytesWritten: run.bytesWritten.toString(),
    sizeBytes: run.sizeBytes.toString(),

    storageProvider: run.storageProvider,
    storageKey: run.storageKey,
    bucket: run.bucket,
    format: run.format,
    checksumSha256: run.checksumSha256,
    verifiedAt: isoOrNull(run.verifiedAt),

    dbVersion: run.dbVersion,
    appVersion: run.appVersion,
    migrationName: run.migrationName,
    pgDumpVersion: run.pgDumpVersion,

    lastError: run.lastError,

    startedAt: isoOrNull(run.startedAt),
    finishedAt: isoOrNull(run.finishedAt),
    lastHeartbeatAt: isoOrNull(run.lastHeartbeatAt),

    createdById: run.createdById,

    // The restore columns. `restoreStatus` is a plain string column in
    // `schema.prisma` (deliberately — see `RESTORE_STATUSES`), so it is
    // narrowed here rather than trusted: a value the enum does not list would
    // otherwise reach the wire and fail this DTO's own schema at the boundary
    // of a subsystem where a wrong answer is destructive.
    restoreStatus: toRestoreStatus(run.restoreStatus),
    restoreError: run.restoreError,
    restoredAt: isoOrNull(run.restoredAt),
    restoredById: run.restoredById,
    restoreScratchDb: run.restoreScratchDb,
    restoreOldDb: run.restoreOldDb,
    swappedAt: isoOrNull(run.swappedAt),
    preRestoreBackupId: run.preRestoreBackupId,

    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

/**
 * The stored `restore_status` string, narrowed to {@link RESTORE_STATUSES}.
 *
 * Anything unrecognised becomes `null` rather than being passed through. The
 * column is a plain `text` — which is why `rolled_back` cost no migration — so
 * a value written by a newer build, or by hand during an incident, is a real
 * possibility. Publishing it verbatim would put a string outside the documented
 * enum into a response a client narrows on; `null` reads as "no restore state
 * this build understands", which is true.
 */
function toRestoreStatus(value: string | null): RestoreStatusName | null {
  return value !== null && (RESTORE_STATUSES as readonly string[]).includes(value)
    ? (value as RestoreStatusName)
    : null;
}
